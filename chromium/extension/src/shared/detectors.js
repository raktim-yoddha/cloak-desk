/*
 * Cloak Desk Browser Safety: what counts as sensitive.
 *
 * Every detector has a cheap `quick` pre-check, a global regex and an optional `valid`
 * checksum/shape test that keeps false positives down (Luhn for cards, mod-97 for IBAN,
 * Verhoeff for Aadhaar, real octets for IPs...). `group: n` masks only capture group n
 * (for "password = hunter2" we hide the value, not the word "password").
 *
 * Plain script (no modules) so it loads the same way in content scripts, the service
 * worker, extension pages and Node tests.
 */
(function (root) {
  'use strict';

  const NS = (root.CloakDesk = root.CloakDesk || {});

  // ---------- checksums ----------

  function luhn(digits) {
    let sum = 0;
    let dbl = false;
    for (let i = digits.length - 1; i >= 0; i--) {
      let d = digits.charCodeAt(i) - 48;
      if (dbl) {
        d *= 2;
        if (d > 9) d -= 9;
      }
      sum += d;
      dbl = !dbl;
    }
    return sum % 10 === 0;
  }

  function ibanValid(raw) {
    const s = raw.replace(/\s+/g, '').toUpperCase();
    if (s.length < 15 || s.length > 34) return false;
    const r = s.slice(4) + s.slice(0, 4);
    let rem = 0;
    for (const ch of r) {
      const code = ch.charCodeAt(0);
      const v = code >= 65 && code <= 90 ? String(code - 55) : ch;
      for (const c of v) rem = (rem * 10 + (c.charCodeAt(0) - 48)) % 97;
    }
    return rem === 1;
  }

  const VD = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 3, 4, 0, 6, 7, 8, 9, 5], [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7], [4, 0, 1, 2, 3, 9, 5, 6, 7, 8], [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2], [7, 6, 5, 9, 8, 2, 1, 0, 4, 3], [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
  ];
  const VP = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 5, 7, 6, 2, 8, 3, 0, 9, 4], [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7], [9, 4, 5, 3, 1, 2, 6, 8, 7, 0], [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5], [7, 0, 4, 6, 9, 1, 3, 2, 8, 5],
  ];
  function verhoeff(digits) {
    let c = 0;
    const n = digits.length;
    for (let i = 0; i < n; i++) c = VD[c][VP[i % 8][digits.charCodeAt(n - 1 - i) - 48]];
    return c === 0;
  }

  const onlyDigits = (s) => s.replace(/\D+/g, '');
  const hasDigit = (s) => /\d/.test(s);

  function phoneValid(m) {
    const d = onlyDigits(m);
    const plus = /^\s*(\+|00)/.test(m);
    const seps = /[\s().\- ]/.test(m.replace(/^\s*\+/, ''));
    if (d.length < 8 || d.length > 15) return false;
    // dates, times, decimals and versions are not phone numbers
    if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}$/.test(m) || /^\d{1,2}[-./]\d{1,2}[-./]\d{2,4}$/.test(m)) return false;
    if (/^\d+\.\d+$/.test(m) || /^\d{1,3}(\.\d{1,3}){2,3}$/.test(m)) return false;
    if (!plus && !seps) return d.length === 10 && /^[2-9]/.test(d); // bare 10-digit mobile/US number
    if (!plus && d.length < 10) return false;
    // reject long runs of single-digit groups like "1 2 3 4 5 6 7 8"
    if ((m.match(/\d+/g) || []).filter((g) => g.length === 1).length > 3) return false;
    return true;
  }

  function cardValid(m) {
    const d = onlyDigits(m);
    if (d.length < 13 || d.length > 19) return false;
    if (/^(\d)\1+$/.test(d)) return false;
    const groups = m.split(/[ -]/);
    if (groups.length > 1 && groups.some((g) => g.length < 3 || g.length > 6)) return false;
    return luhn(d);
  }

  function ipv4Valid(m) {
    return m !== '0.0.0.0' && !m.startsWith('127.') && m !== '255.255.255.255';
  }

  function ipv6Valid(m) {
    if (m === '::1' || m === '::') return false;
    if ((m.match(/:/g) || []).length < 2 || !/[0-9a-f]/i.test(m)) return false;
    try {
      new URL('http://[' + m + ']/');
      return true;
    } catch (_) {
      return false;
    }
  }

  function btcLegacyValid(m) {
    return /\d/.test(m) && /[a-z]/.test(m) && /[A-Z]/.test(m);
  }

  // ---------- detectors ----------

  /** @type {Array<{id:string,label:string,hint:string,example:string,rules:Array<{re:RegExp,quick?:(s:string)=>boolean,valid?:(m:string)=>boolean,group?:number}>}>} */
  const DETECTORS = [
    {
      id: 'email',
      label: 'Email addresses',
      hint: 'Work and personal inboxes',
      example: 'raktim.yoddha@gmail.com',
      rules: [
        {
          quick: (s) => s.includes('@'),
          re: /(?<![\w.%+-])[A-Za-z0-9](?:[A-Za-z0-9._%+-]{0,63})@(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,24}(?![A-Za-z0-9-])/g,
        },
      ],
    },
    {
      id: 'phone',
      label: 'Phone numbers',
      hint: '+91 98765 43210, (415) 555-0132, international formats',
      example: '+91 98765 43210',
      rules: [
        {
          quick: (s) => /\d{3}/.test(s) || /\d[\s().\-]\d/.test(s),
          re: /(?<![\w+(\-.\/:])(?:(?:\+|00)\d{1,3}[\s.\- ]?)?(?:\(\d{1,5}\)[\s.\- ]?)?\d[\d\s.\- ]{5,17}\d(?![\w\-]|\.\d|:\d)/g,
          valid: phoneValid,
        },
      ],
    },
    {
      id: 'card',
      label: 'Payment cards',
      hint: 'Visa, Mastercard, Amex, RuPay',
      example: '4111 1111 1111 1111',
      rules: [
        {
          quick: (s) => /\d{4}/.test(s),
          re: /(?<![\d-])\d(?:[ -]?\d){12,18}(?![\d-])/g,
          valid: cardValid,
        },
      ],
    },
    {
      id: 'iban',
      label: 'Bank accounts (IBAN)',
      hint: 'International bank account numbers',
      example: 'GB82 WEST 1234 5698 7654 32',
      rules: [
        {
          quick: (s) => /[A-Z]{2}\d{2}/.test(s),
          re: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}\b/g,
          valid: ibanValid,
        },
      ],
    },
    {
      id: 'govid',
      label: 'Government IDs',
      hint: 'Aadhaar, PAN, US SSN, UK National Insurance',
      example: 'ABCPE1234F',
      rules: [
        { quick: hasDigit, re: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g },
        {
          quick: hasDigit,
          re: /(?<![\d-])[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d-])/g,
          valid: (m) => verhoeff(onlyDigits(m)),
        },
        { quick: hasDigit, re: /\b[A-Z]{3}[PCHFATBLJG][A-Z]\d{4}[A-Z]\b/g },
        {
          quick: hasDigit,
          re: /\b(?!BG|GB|NK|KN|TN|NT|ZZ)[A-CEGHJ-PR-TW-Z][A-CEGHJ-NPR-TW-Z] ?\d{2} ?\d{2} ?\d{2} ?[A-D]\b/g,
        },
      ],
    },
    {
      id: 'secrets',
      label: 'API keys, tokens & passwords',
      hint: 'GitHub, AWS, Stripe, Google, OpenAI, Slack, JWTs, private keys, and password = … lines',
      example: 'ghp_8fK2xQ9mVt7Lr1ZsP0cWbN4yHd6Ue3Ja5Gk',
      rules: [
        {
          quick: (s) => s.includes('-----BEGIN'),
          re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|$)/g,
        },
        { re: /\b(?:AKIA|ASIA|AGPA|AIDA|AROA|ANPA|ANVA|AIPA)[A-Z0-9]{16}\b/g },
        { re: /\b(?:gh[pousr]_[A-Za-z0-9]{36,255}|github_pat_[A-Za-z0-9_]{22,255})\b/g },
        { re: /\bglpat-[A-Za-z0-9_-]{20,}\b/g },
        { re: /\bxox[abposr]-[A-Za-z0-9-]{10,}\b/g },
        { re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+/g },
        { re: /https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/g },
        { re: /\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
        { re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
        { re: /\bsk-(?:ant-|proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g },
        { re: /\bnpm_[A-Za-z0-9]{36}\b/g },
        { re: /\bhf_[A-Za-z0-9]{30,}\b/g },
        { re: /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
        // user:password@ in URLs
        { quick: (s) => s.includes('://'), re: /:\/\/[^\s/:@]+:([^\s/@]+)@/g, group: 1 },
        // Bearer tokens
        { quick: (s) => /bearer/i.test(s), re: /\bBearer\s+([A-Za-z0-9._~+/-]{16,}=*)/gi, group: 1 },
        // key = value assignments (.env files, configs, settings pages)
        {
          quick: (s) => /[:=]/.test(s),
          re: /(?<![A-Za-z])(?:api[_-]?key|apikey|secret(?:[_-]?key)?|client[_-]?secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|private[_-]?key|token|password|passwd|pwd|passcode|pin)\b["']?\s*[:=]\s*["']?([^\s"'<>,;]{4,})/gi,
          group: 1,
        },
      ],
    },
    {
      id: 'ip',
      label: 'IP addresses',
      hint: 'Home and server IPv4 or IPv6 addresses',
      example: '203.0.113.42',
      rules: [
        {
          quick: (s) => /\d\.\d/.test(s),
          re: /(?<![\d.])(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?![\d.]|\.\d)/g,
          valid: ipv4Valid,
        },
        {
          quick: (s) => s.includes(':'),
          re: /(?<![\w:.])(?:[0-9A-Fa-f]{1,4}:){1,7}(?::|(?::[0-9A-Fa-f]{1,4}){1,7}|[0-9A-Fa-f]{1,4})(?![\w:])/g,
          valid: ipv6Valid,
        },
      ],
    },
    {
      id: 'crypto',
      label: 'Crypto wallets',
      hint: 'Bitcoin and Ethereum addresses',
      example: '0x52908400098527886E0F7030069857D2E4169EE7',
      rules: [
        { re: /\b0x[a-fA-F0-9]{40}\b/g },
        { re: /\b(?:bc1|tb1)[ac-hj-np-z02-9]{25,87}\b/g },
        { re: /\b[13][a-km-zA-HJ-NP-Z1-9]{25,34}\b/g, valid: btcLegacyValid },
      ],
    },
  ];

  const DETECTOR_IDS = DETECTORS.map((d) => d.id);

  // ---------- custom words and patterns ----------

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** Parses "/body/flags" or a raw pattern. Returns a global RegExp or throws. */
  function parsePattern(src) {
    const text = String(src || '').trim();
    if (!text) throw new Error('Empty pattern');
    if (text.length > 500) throw new Error('Pattern is longer than 500 characters');
    let body = text;
    let flags = 'i';
    const m = /^\/(.+)\/([a-z]*)$/s.exec(text);
    if (m) {
      body = m[1];
      flags = m[2];
      if (/[^imsu]/.test(flags)) throw new Error('Only the i, m, s and u flags are allowed');
    }
    const re = new RegExp(body, flags.replace(/g/g, '') + 'gd');
    if (re.test('')) throw new Error('Pattern matches empty text');
    re.lastIndex = 0;
    return re;
  }

  // ---------- matcher ----------

  /**
   * Builds a matcher for the given settings.
   * @param {{detectors?:Record<string,boolean>, customWords?:string[], customPatterns?:string[]}} cfg
   * @returns {{find:(text:string)=>Array<[number,number]>, empty:boolean}}
   */
  function createMatcher(cfg) {
    const enabled = (cfg && cfg.detectors) || {};
    const rules = [];
    for (const det of DETECTORS) {
      if (enabled[det.id] === false) continue;
      for (const r of det.rules) {
        const flags = r.re.flags.includes('d') || !r.group ? r.re.flags : r.re.flags + 'd';
        rules.push({ re: new RegExp(r.re.source, flags), quick: r.quick, valid: r.valid, group: r.group });
      }
    }
    const words = ((cfg && cfg.customWords) || [])
      .map((w) => String(w).trim())
      .filter((w) => w.length >= 2)
      .sort((a, b) => b.length - a.length);
    if (words.length) {
      const lower = words.map((w) => w.toLowerCase());
      rules.push({
        re: new RegExp(words.map(escapeRe).join('|'), 'gi'),
        quick: (s) => {
          const l = s.toLowerCase();
          return lower.some((w) => l.includes(w));
        },
      });
    }
    for (const p of (cfg && cfg.customPatterns) || []) {
      try {
        rules.push({ re: parsePattern(p) });
      } catch (_) {
        /* invalid patterns are reported in the settings page and skipped here */
      }
    }

    function find(text) {
      if (!text || text.length < 2) return [];
      const out = [];
      for (const r of rules) {
        if (r.quick && !r.quick(text)) continue;
        const re = r.re;
        re.lastIndex = 0;
        let m;
        let guard = 0;
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          if (++guard > 5000) break;
          if (r.valid && !r.valid(m[0])) {
            continue;
          }
          if (r.group && m.indices && m.indices[r.group]) {
            const [s, e] = m.indices[r.group];
            if (e > s) out.push([s, e]);
          } else {
            out.push([m.index, m.index + m[0].length]);
          }
        }
      }
      if (out.length < 2) return out;
      out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      const merged = [out[0]];
      for (let i = 1; i < out.length; i++) {
        const last = merged[merged.length - 1];
        if (out[i][0] <= last[1]) last[1] = Math.max(last[1], out[i][1]);
        else merged.push(out[i]);
      }
      return merged;
    }

    return { find, empty: rules.length === 0 };
  }

  /** Replaces every match with a bullet run. Used for tab titles and notifications. */
  function scrub(matcher, text, mask) {
    const spans = matcher.find(text);
    if (!spans.length) return text;
    let out = '';
    let at = 0;
    for (const [s, e] of spans) {
      out += text.slice(at, s) + (mask || '•••••');
      at = e;
    }
    return out + text.slice(at);
  }

  NS.detectors = { list: DETECTORS, ids: DETECTOR_IDS, createMatcher, parsePattern, scrub, luhn, ibanValid, verhoeff };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.detectors;
})(typeof globalThis !== 'undefined' ? globalThis : self);
