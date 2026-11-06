/*
 * Cloak Desk Browser Safety: settings shape, defaults and helpers.
 * Everything lives in chrome.storage.local on this device. Nothing is synced or sent anywhere.
 */
(function (root) {
  'use strict';

  const NS = (root.CloakDesk = root.CloakDesk || {});

  const STYLES = ['redact', 'blur', 'tint'];
  const MODES = ['always', 'sharing'];

  const DEFAULTS = Object.freeze({
    schema: 1,
    /** Master switch. Off after install: the user turns it on. */
    enabled: false,
    /** 'always' = hide whenever on; 'sharing' = only while a tab in this browser shares the screen. */
    mode: 'always',
    detectors: { email: true, phone: true, card: true, iban: true, govid: true, secrets: true, ip: true, crypto: true },
    customWords: [],
    customPatterns: [],
    /** Hide what is typed into email, phone, card, address, password and secret fields. */
    fields: true,
    /** Remove sensitive details from tab titles (e.g. "Inbox - you@gmail.com - Gmail"). */
    titles: true,
    /** Replace web notification text while hiding is active. */
    notifications: true,
    /** Sites where nothing is hidden. */
    allowSites: [],
    /** Sites covered by a full-page curtain while hiding is active. */
    curtainSites: ['vault.bitwarden.com', 'my.1password.com', 'lastpass.com', 'passwords.google.com', 'dashlane.com'],
    style: 'redact',
    color: '#c9ccd2',
    badge: true,
    onboarded: false,
  });

  const clone = (o) => JSON.parse(JSON.stringify(o));
  const strList = (v, max) =>
    Array.isArray(v)
      ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))].slice(0, max || 500).map((x) => x.slice(0, 500))
      : [];

  /** Returns a complete, type-checked settings object from anything stored or imported. */
  function normalize(raw) {
    const s = clone(DEFAULTS);
    if (!raw || typeof raw !== 'object') return s;
    for (const k of ['enabled', 'fields', 'titles', 'notifications', 'badge', 'onboarded']) {
      if (typeof raw[k] === 'boolean') s[k] = raw[k];
    }
    if (MODES.includes(raw.mode)) s.mode = raw.mode;
    if (STYLES.includes(raw.style)) s.style = raw.style;
    // '#4b3bff' was the 0.1 default (violet); anyone still on it moves to the new silver default
    if (typeof raw.color === 'string' && /^#[0-9a-f]{6}$/i.test(raw.color) && raw.color.toLowerCase() !== '#4b3bff') s.color = raw.color.toLowerCase();
    if (raw.detectors && typeof raw.detectors === 'object') {
      for (const k of Object.keys(s.detectors)) if (typeof raw.detectors[k] === 'boolean') s.detectors[k] = raw.detectors[k];
    }
    s.customWords = strList(raw.customWords);
    s.customPatterns = strList(raw.customPatterns, 100);
    if (Array.isArray(raw.allowSites)) s.allowSites = strList(raw.allowSites).map(normalizeSite).filter(Boolean);
    if (Array.isArray(raw.curtainSites)) s.curtainSites = strList(raw.curtainSites).map(normalizeSite).filter(Boolean);
    return s;
  }

  /** "https://Mail.Google.com/u/0" -> "mail.google.com"; "*.example.com" -> "example.com". */
  function normalizeSite(v) {
    let s = String(v || '').trim().toLowerCase();
    if (!s) return '';
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\*\./, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '');
    s = s.replace(/^www\./, '');
    return /^[a-z0-9.-]+$/.test(s) && s.includes('.') ? s : /^localhost$/.test(s) ? s : '';
  }

  /** True if host is the site or one of its subdomains. */
  function hostMatches(host, list) {
    host = String(host || '').toLowerCase().replace(/^www\./, '');
    if (!host) return false;
    return (list || []).some((site) => host === site || host.endsWith('.' + site));
  }

  /** Whether hiding should be on for a page, given settings and whether this browser is sharing. */
  function isActive(settings, sharing, host) {
    if (!settings.enabled) return false;
    if (settings.mode === 'sharing' && !sharing) return false;
    return !hostMatches(host, settings.allowSites);
  }

  NS.settings = { DEFAULTS, STYLES, MODES, normalize, normalizeSite, hostMatches, isActive, KEY: 'settings', RUNTIME_KEY: 'runtime' };

  if (typeof module !== 'undefined' && module.exports) module.exports = NS.settings;
})(typeof globalThis !== 'undefined' ? globalThis : self);
