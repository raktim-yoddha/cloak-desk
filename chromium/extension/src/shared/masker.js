/*
 * Cloak Desk Browser Safety: the masking engine.
 *
 * Sensitive text is painted over with the CSS Custom Highlight API: we register live
 * Ranges in a `Highlight` and style `::highlight(cloakdesk)`. The page's DOM is never
 * changed, so React/Angular apps, editors and contenteditable keep working, and the
 * mask is drawn in the same paint as the text (no overlay lag while scrolling).
 *
 * Text is matched per block ("container"), so a number split across <span>s is still
 * found. A MutationObserver re-checks changed blocks synchronously, before the next
 * frame is painted. Open and closed shadow roots are followed.
 */
(function (root) {
  'use strict';

  const NS = (root.CloakDesk = root.CloakDesk || {});
  // Each page gets its own random highlight name, so page scripts can't target it.
  const newName = () => 'cd-' + Math.random().toString(36).slice(2, 10);
  const FIELD_ATTR = 'data-cloakdesk-field';
  const UI_ATTR = 'data-cloakdesk-ui';
  const MAX_TEXT = 400000;

  const BLOCK = new Set(
    ('ADDRESS ARTICLE ASIDE BLOCKQUOTE BODY BUTTON CAPTION DD DETAILS DIALOG DIV DL DT FIELDSET FIGCAPTION ' +
      'FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HGROUP HR HTML LEGEND LI MAIN MENU NAV OL P PRE SECTION ' +
      'SUMMARY TABLE TBODY TD TFOOT TH THEAD TR UL').split(' ')
  );
  const SKIP = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TEXTAREA', 'HEAD', 'TITLE', 'IFRAME', 'OBJECT', 'CANVAS', 'VIDEO', 'AUDIO', 'SELECT', 'INPUT']);

  const FIELD_TYPES = new Set(['', 'text', 'search', 'email', 'tel', 'url', 'password', 'number']);
  const SENSITIVE_TYPES = new Set(['email', 'tel', 'password']);
  const AUTOCOMPLETE_RE = /\b(email|tel|tel-national|tel-local|cc-number|cc-csc|cc-exp|cc-name|street-address|address-line\d|address-level\d|postal-code|bday|one-time-code|new-password|current-password)\b/i;
  const NAME_RE = /(e-?mail|phone|mobile|\btel\b|card.?num|cc.?num|\bcvv|\bcvc|\biban|\bssn\b|aadh?aar|\bpan(?:.?(?:no|number|card))?\b|passport|street|address|zip|postal|\botp\b|secret|token|api.?key|pass(?:word|wd|code|phrase)?\b|\bpwd\b|\bpin\b)/i;

  function hexToRgb(hex) {
    const n = parseInt(String(hex || '#c9ccd2').slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(',');
  }

  /** CSS for a mask style. Same output in pages, the settings preview and tests. */
  function buildCss(style, color, name) {
    const rgb = hexToRgb(color);
    const hide = 'color:transparent!important;-webkit-text-fill-color:transparent!important;text-decoration:none!important;';
    let hl;
    if (style === 'blur') hl = `${hide}background-color:rgba(${rgb},.10);text-shadow:0 0 .55em rgba(${rgb},.9)!important;`;
    else if (style === 'tint') hl = `${hide}background-color:rgba(${rgb},.32);text-shadow:none!important;`;
    else hl = `${hide}background-color:${color};text-shadow:none!important;`;
    return (
      `::highlight(${name || 'cloakdesk'}){${hl}}\n` +
      `input[${FIELD_ATTR}]{-webkit-text-security:disc!important;}\n` +
      `textarea[${FIELD_ATTR}]{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:0 0 .6em rgba(${rgb},.85)!important;}\n`
    );
  }

  // While a selection overlaps a mask, selected text is painted transparent too
  // (::selection paints above custom highlights and would otherwise reveal it).
  const GUARD_CSS = '::selection{color:transparent!important;-webkit-text-fill-color:transparent!important;text-shadow:none!important;background-color:rgba(160,164,172,.28)!important;}';

  /**
   * @param {{doc?:Document, scope?:Element, onCount?:(n:number)=>void, shadowOf?:(el:Element)=>ShadowRoot|null}} env
   */
  function createMasker(env) {
    const doc = (env && env.doc) || document;
    const win = doc.defaultView || root;
    const scope = (env && env.scope) || null;
    const onCount = (env && env.onCount) || null;
    const shadowOf =
      (env && env.shadowOf) ||
      ((el) => {
        return el.shadowRoot || null;
      });

    let running = false;
    let matcher = null;
    let opts = { fields: true };
    let highlight = null;
    const sheet = new win.CSSStyleSheet();
    const guardSheet = new win.CSSStyleSheet();
    let guardOn = false;
    /** @type {Map<Node, Range[]>} */
    const containers = new Map();
    /** @type {Map<Document|ShadowRoot, MutationObserver>} */
    const roots = new Map();
    const fields = new Set();
    const everPassword = new WeakSet();
    const pending = new Set();
    const deep = new Set();
    let countTimer = 0;
    let lastCount = -1;
    let fieldTimer = 0;
    const hlName = (env && env.name) || newName();
    let sweepTimer = 0;

    // ---------- styles ----------

    /** r is a Document or ShadowRoot; ours go last so they win over page sheets of equal specificity. */
    function ensureStyles(r) {
      try {
        const list = r.adoptedStyleSheets;
        if (!list.includes(sheet) || !list.includes(guardSheet)) {
          r.adoptedStyleSheets = [...list.filter((s) => s !== sheet && s !== guardSheet), sheet, guardSheet];
        }
      } catch (_) {
        /* document without adoptedStyleSheets support */
      }
    }

    function removeStyles(r) {
      try {
        r.adoptedStyleSheets = r.adoptedStyleSheets.filter((s) => s !== sheet && s !== guardSheet);
      } catch (_) {
        /* ignore */
      }
    }

    function setGuard(on) {
      if (on === guardOn) return;
      guardOn = on;
      guardSheet.replaceSync(on ? GUARD_CSS : '');
    }

    // ---------- containers ----------

    function inScope(node) {
      return !scope || scope === node || scope.contains(node);
    }

    function containerOf(node) {
      let n = node && (node.nodeType === 1 || node.nodeType === 11 ? node : node.parentNode);
      while (n) {
        if (n.nodeType === 11) return n;
        if (n.nodeType === 9) return n.documentElement;
        if (n.nodeType === 1) {
          if (SKIP.has(n.nodeName) || n.hasAttribute(UI_ATTR)) return null;
          if (n === scope || BLOCK.has(n.nodeName)) return n;
        }
        if (n === scope) return n;
        n = n.parentNode;
      }
      return null;
    }

    /** Grid/flex cells and inline-blocks are separate boxes on screen even when their tag is <span>. */
    function isInline(el) {
      let d = '';
      try {
        d = win.getComputedStyle(el).display;
      } catch (_) {
        /* not an element we can style */
      }
      return !d || d === 'inline' || d === 'contents' || d === 'none';
    }

    /** Matches in the joined text plus matches inside each single text node, merged, in joined-text offsets. */
    function findBoth(text, nodes, starts) {
      const out = matcher.find(text);
      if (nodes.length > 1) {
        for (let i = 0; i < nodes.length; i++) {
          const d = nodes[i].data;
          if (d.length < 5) continue;
          for (const [s, e] of matcher.find(d)) out.push([starts[i] + s, starts[i] + e]);
        }
      }
      if (out.length < 2) return out;
      out.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      const merged = [out[0]];
      for (let k = 1; k < out.length; k++) {
        const last = merged[merged.length - 1];
        if (out[k][0] <= last[1]) last[1] = Math.max(last[1], out[k][1]);
        else merged.push(out[k]);
      }
      return merged;
    }

    function dropContainer(c) {
      const old = containers.get(c);
      if (old) {
        for (const r of old) highlight.delete(r);
        containers.delete(c);
      }
    }

    function processContainer(c) {
      dropContainer(c);
      if (!c.isConnected || !inScope(c)) return;
      const nodes = [];
      const starts = [];
      let text = '';
      // Two views of the same text, and matches from both are hidden:
      //  joined: text of inline elements runs together, so "+91 <b>98765</b> 43210" is one number;
      //          boxes (grid/flex cells, inline-blocks) are kept apart using their computed display;
      //  split:  every text node on its own, which is right even before the page's CSS has loaded
      //          (cells like "…@mail.in" + "10:42" can't be glued into a non-match).
      const collect = (parent) => {
        for (let n = parent.firstChild; n; n = n.nextSibling) {
          if (text.length > MAX_TEXT) return;
          if (n.nodeType === 3) {
            starts.push(text.length);
            nodes.push(n);
            text += n.data;
            continue;
          }
          if (n.nodeType !== 1) continue;
          const name = n.nodeName;
          if (SKIP.has(name) || n.hasAttribute(UI_ATTR)) {
            if (opts.fields && (name === 'INPUT' || name === 'TEXTAREA')) checkField(n);
            continue;
          }
          const sr = shadowOf(n);
          if (sr) attachRoot(sr);
          if (BLOCK.has(name) || name === 'BR') {
            text += '\n'; // its own container (or a line break)
            continue;
          }
          const boxed = !isInline(n);
          if (boxed) text += '\n';
          collect(n);
          if (boxed) text += '\n';
        }
      };
      collect(c);
      if (!nodes.length) return;
      const spans = findBoth(text, nodes, starts);
      if (!spans.length) return;
      const ranges = [];
      for (const [s, e] of spans) {
        // first node that ends after s, last node that starts before e
        let lo = 0;
        let hi = nodes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi) >> 1;
          if (starts[mid] + nodes[mid].data.length > s) hi = mid;
          else lo = mid + 1;
        }
        const i = lo;
        lo = i;
        hi = nodes.length - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (starts[mid] < e) lo = mid;
          else hi = mid - 1;
        }
        const j = lo;
        try {
          const r = new win.Range();
          r.setStart(nodes[i], Math.max(0, s - starts[i]));
          r.setEnd(nodes[j], Math.min(nodes[j].data.length, e - starts[j]));
          if (!r.collapsed) {
            ranges.push(r);
            highlight.add(r);
          }
        } catch (_) {
          /* node changed under us; the observer will re-run */
        }
      }
      if (ranges.length) containers.set(c, ranges);
    }

    function scanTree(base) {
      if (!base) return;
      if (base.nodeType === 9) base = base.documentElement;
      if (!base || !inScope(base)) return;
      const top = base.nodeType === 11 ? base : containerOf(base);
      if (top) pending.add(top);
      if (base.nodeType === 1) {
        const sr = shadowOf(base);
        if (sr) attachRoot(sr);
        if (opts.fields && (base.nodeName === 'INPUT' || base.nodeName === 'TEXTAREA')) checkField(base);
      }
      const it = doc.createTreeWalker(base, 1 /* SHOW_ELEMENT */, {
        acceptNode(n) {
          return SKIP.has(n.nodeName) && n.nodeName !== 'INPUT' && n.nodeName !== 'TEXTAREA' ? 2 : 1;
        },
      });
      let el;
      while ((el = it.nextNode())) {
        if (el.hasAttribute(UI_ATTR)) continue;
        const name = el.nodeName;
        if (BLOCK.has(name)) pending.add(el);
        else if (opts.fields && (name === 'INPUT' || name === 'TEXTAREA')) checkField(el);
        const sr = shadowOf(el);
        if (sr) attachRoot(sr);
      }
    }

    function flush() {
      if (!running) return;
      for (const el of deep) scanTree(el);
      deep.clear();
      for (const c of pending) processContainer(c);
      pending.clear();
      for (const r of roots.keys()) ensureStyles(r);
      scheduleCount();
    }

    function onMutations(records) {
      if (!running) return;
      for (const rec of records) {
        if (rec.type === 'characterData') {
          const c = containerOf(rec.target);
          if (c) pending.add(c);
          continue;
        }
        const c = containerOf(rec.target);
        if (c) pending.add(c);
        else if (rec.target.nodeType === 1 && SKIP.has(rec.target.nodeName)) continue;
        for (const n of rec.addedNodes) {
          if (n.nodeType === 1) {
            if (n.firstElementChild || BLOCK.has(n.nodeName) || shadowOf(n) || n.nodeName === 'INPUT' || n.nodeName === 'TEXTAREA') deep.add(n);
          } else if (n.nodeType === 11) deep.add(n);
        }
      }
      flush();
    }

    function attachRoot(r) {
      if (roots.has(r)) return;
      const mo = new win.MutationObserver(onMutations);
      mo.observe(r, { childList: true, characterData: true, subtree: true });
      roots.set(r, mo);
      if (r.nodeType === 11) {
        ensureStyles(r);
        if (running) deep.add(r);
      }
    }

    // ---------- form fields ----------

    function isTextField(el) {
      if (el.nodeName === 'TEXTAREA') return true;
      if (el.nodeName !== 'INPUT') return false;
      const type = (el.getAttribute('type') || '').toLowerCase();
      return FIELD_TYPES.has(type);
    }

    function checkField(el) {
      if (!isTextField(el)) return;
      const type = (el.getAttribute('type') || '').toLowerCase();
      if (type === 'password') everPassword.add(el);
      const hints = [el.getAttribute('name'), el.id, el.getAttribute('aria-label'), el.getAttribute('placeholder'), el.getAttribute('data-testid')].join(' ');
      const value = el.value;
      const sensitive =
        everPassword.has(el) ||
        SENSITIVE_TYPES.has(type) ||
        AUTOCOMPLETE_RE.test(el.getAttribute('autocomplete') || '') ||
        NAME_RE.test(hints) ||
        (value && value.length > 3 && matcher.find(value).length > 0);
      if (sensitive) {
        if (!el.hasAttribute(FIELD_ATTR)) el.setAttribute(FIELD_ATTR, '');
        fields.add(el);
      } else if (fields.has(el)) {
        el.removeAttribute(FIELD_ATTR);
        fields.delete(el);
      }
    }

    function onFieldEvent(e) {
      const t = e.composedPath ? e.composedPath()[0] : e.target;
      if (t && t.nodeType === 1 && inScope(t)) {
        checkField(t);
        scheduleCount();
      }
    }

    function recheckFields() {
      // values set by scripts fire no events; look again now and then
      const list = (scope || doc).querySelectorAll('input, textarea');
      for (let i = 0; i < list.length && i < 2000; i++) checkField(list[i]);
      for (const r of roots.keys()) if (r.nodeType === 11) r.querySelectorAll('input, textarea').forEach(checkField);
      scheduleCount();
    }

    // ---------- selection guard ----------

    function selectionHitsMask() {
      const sel = doc.getSelection && doc.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
      const r = sel.getRangeAt(0);
      for (const m of highlight) {
        try {
          if (r.compareBoundaryPoints(win.Range.START_TO_END, m) === 1 && r.compareBoundaryPoints(win.Range.END_TO_START, m) === -1) return true;
        } catch (_) {
          /* different tree (shadow root): be safe */
          return true;
        }
      }
      for (const f of fields) if (f.isConnected && sel.containsNode(f, true)) return true;
      return false;
    }

    function onSelectStart() {
      if (highlight && highlight.size) setGuard(true);
    }

    function onSelectionChange() {
      setGuard(selectionHitsMask());
    }

    // ---------- count ----------

    function count() {
      let n = 0;
      for (const ranges of containers.values()) n += ranges.length;
      for (const f of fields) if (f.isConnected) n++;
      return n;
    }

    function scheduleCount() {
      if (!onCount || countTimer) return;
      countTimer = win.setTimeout(() => {
        countTimer = 0;
        const n = running ? count() : 0;
        if (n !== lastCount) {
          lastCount = n;
          onCount(n);
        }
      }, 250);
    }

    function sweep() {
      for (const c of [...containers.keys()]) if (!c.isConnected) dropContainer(c);
      for (const f of [...fields]) if (!f.isConnected) fields.delete(f);
      for (const [r, mo] of [...roots]) {
        if (r.nodeType === 11 && !r.host.isConnected) {
          mo.disconnect();
          roots.delete(r);
        }
      }
    }

    // ---------- tamper guard ----------

    // A page calling CSS.highlights.clear() or replacing document.adoptedStyleSheets would drop
    // the masks. Check once per frame (rAF runs right before paint) and put them back, so no
    // frame is ever painted without them. Costs one map lookup per frame; paused in hidden tabs.
    function guardFrame() {
      if (!running) return;
      if (win.CSS.highlights.get(hlName) !== highlight) win.CSS.highlights.set(hlName, highlight);
      ensureStyles(doc);
      win.requestAnimationFrame(guardFrame);
    }

    // ---------- lifecycle ----------

    function start(m, o) {
      matcher = m;
      opts = Object.assign({ fields: true, style: 'redact', color: '#c9ccd2' }, o || {});
      sheet.replaceSync(buildCss(opts.style, opts.color, hlName));
      if (!running) {
        running = true;
        highlight = new win.Highlight();
        highlight.priority = 1000;
        win.CSS.highlights.set(hlName, highlight);
        attachRoot(doc);
        ensureStyles(doc);
        doc.addEventListener('input', onFieldEvent, true);
        doc.addEventListener('change', onFieldEvent, true);
        doc.addEventListener('focusin', onFieldEvent, true);
        doc.addEventListener('selectstart', onSelectStart, true);
        doc.addEventListener('selectionchange', onSelectionChange, true);
        fieldTimer = win.setInterval(() => opts.fields && recheckFields(), 1500);
        win.requestAnimationFrame(guardFrame);
        sweepTimer = win.setInterval(sweep, 10000);
      }
      rescan();
    }

    /** Re-checks everything, e.g. after settings changed. */
    function rescan() {
      if (!running) return;
      for (const c of [...containers.keys()]) dropContainer(c);
      if (!opts.fields) {
        for (const f of fields) f.removeAttribute(FIELD_ATTR);
        fields.clear();
      }
      deep.add(scope || doc);
      for (const r of roots.keys()) if (r.nodeType === 11) deep.add(r);
      flush();
    }

    function stop() {
      if (!running) return;
      running = false;
      for (const mo of roots.values()) mo.disconnect();
      for (const r of roots.keys()) removeStyles(r);
      roots.clear();
      containers.clear();
      pending.clear();
      deep.clear();
      if (win.CSS.highlights.get(hlName) === highlight) win.CSS.highlights.delete(hlName);
      highlight = null;
      for (const f of fields) f.removeAttribute(FIELD_ATTR);
      fields.clear();
      setGuard(false);
      doc.removeEventListener('input', onFieldEvent, true);
      doc.removeEventListener('change', onFieldEvent, true);
      doc.removeEventListener('focusin', onFieldEvent, true);
      doc.removeEventListener('selectstart', onSelectStart, true);
      doc.removeEventListener('selectionchange', onSelectionChange, true);
      win.clearInterval(fieldTimer);
      win.clearInterval(sweepTimer);
      lastCount = -1;
      if (onCount) onCount(0);
    }

    /** True while the masks are registered and styled (used by tests and the tamper guard). */
    function intact() {
      return !running || (win.CSS.highlights.get(hlName) === highlight && doc.adoptedStyleSheets.includes(sheet));
    }

    return {
      start,
      stop,
      rescan,
      count,
      intact,
      get running() {
        return running;
      },
    };
  }

  NS.masker = { createMasker, buildCss, FIELD_ATTR, UI_ATTR };
})(typeof globalThis !== 'undefined' ? globalThis : self);
