/*
 * Cloak Desk Browser Safety: content script (isolated world, every frame, document_start).
 * Decides whether this page should hide details and drives the masker, tab title,
 * full-page curtain and notification guard. Settings come straight from storage.
 */
(() => {
  'use strict';

  // After an extension update the old copy of this script is cut off from the extension
  // ("orphaned") and the new copy is injected into open tabs. The new copy takes over.
  if (globalThis.__cloakdesk) {
    try {
      globalThis.__cloakdesk.shutdown();
    } catch (_) {
      /* old copy already gone */
    }
  }

  const READY = 'data-cloakdesk-ready';
  const isTop = window === window.top;

  // ---------- reveal (pairs with prehide.css, which hides the page until we've scanned it) ----------

  let revealed = false;
  let readyObserver = null;
  function reveal() {
    revealed = true;
    const html = document.documentElement;
    if (!html) {
      const mo = new MutationObserver(() => {
        if (document.documentElement) {
          mo.disconnect();
          reveal();
        }
      });
      mo.observe(document, { childList: true });
      return;
    }
    if (!html.hasAttribute(READY)) html.setAttribute(READY, '');
    if (!readyObserver) {
      // some frameworks rewrite <html> attributes on hydration; never leave the page hidden
      readyObserver = new MutationObserver(() => {
        const h = document.documentElement;
        if (h && !h.hasAttribute(READY)) h.setAttribute(READY, '');
      });
      readyObserver.observe(html, { attributes: true, attributeFilter: [READY] });
    }
  }
  // Failsafe first: whatever happens below, the page becomes visible.
  setTimeout(() => revealed || reveal(), 1500);

  const NS = globalThis.CloakDesk;
  const S = NS.settings;
  const D = NS.detectors;
  const M = NS.masker;

  function topHost() {
    if (isTop) return location.hostname;
    try {
      return window.top.location.hostname;
    } catch (_) {
      const a = location.ancestorOrigins;
      if (a && a.length) {
        try {
          return new URL(a[a.length - 1]).hostname;
        } catch (_) {
          /* fall through */
        }
      }
      return location.hostname;
    }
  }
  const HOST = topHost();

  // ---------- messaging ----------

  let orphaned = false;
  function send(msg) {
    if (orphaned) return;
    try {
      chrome.runtime.sendMessage(msg).catch(() => {});
    } catch (_) {
      // extension was reloaded or removed: this copy of the script is dead
      orphaned = true;
      shutdown();
    }
  }

  // ---------- state ----------

  let settings = S.normalize(null);
  let sharing = false;
  let active = false;
  let matcher = null;
  let signature = '';

  const masker = M.createMasker({
    doc: document,
    onCount: (n) => send({ type: 'count', n }),
    shadowOf: (el) => {
      if (el.shadowRoot) return el.shadowRoot;
      if (!el.localName.includes('-') && !el.hasAttribute('is')) {
        // closed roots only on custom elements and the few built-ins that allow attachShadow
        if (!/^(article|aside|blockquote|body|div|footer|h[1-6]|header|main|nav|p|section|span)$/.test(el.localName)) return null;
      }
      try {
        return chrome.dom && chrome.dom.openOrClosedShadowRoot ? chrome.dom.openOrClosedShadowRoot(el) : null;
      } catch (_) {
        return null;
      }
    },
  });

  function apply() {
    if (orphaned) return;
    const want = S.isActive(settings, sharing, HOST);
    const sig = JSON.stringify([settings.detectors, settings.customWords, settings.customPatterns, settings.fields, settings.style, settings.color]);
    if (want) {
      if (!active || sig !== signature) {
        matcher = D.createMatcher(settings);
        masker.start(matcher, { fields: settings.fields, style: settings.style, color: settings.color });
      }
    } else if (active) {
      masker.stop();
    }
    signature = sig;
    active = want;
    applyTitle();
    applyCurtain();
    document.dispatchEvent(new CustomEvent('cloakdesk:state', { detail: active && settings.notifications ? 'on' : 'off' }));
    if (!active) send({ type: 'count', n: 0 });
  }

  // ---------- tab title ----------

  let originalTitle = null;
  let writtenTitle = null;
  let titleObserver = null;

  function applyTitle() {
    if (!isTop) return;
    const want = active && settings.titles;
    if (want && !titleObserver) {
      titleObserver = new MutationObserver((records) => {
        for (const r of records) {
          const t = r.target;
          if (t.nodeName === 'TITLE' || (t.parentNode && t.parentNode.nodeName === 'TITLE') || t.nodeName === 'HEAD') {
            applyTitle();
            return;
          }
        }
      });
      titleObserver.observe(document, { subtree: true, childList: true, characterData: true });
    } else if (!want && titleObserver) {
      titleObserver.disconnect();
      titleObserver = null;
    }
    const cur = document.title;
    if (want) {
      if (cur === writtenTitle) return;
      const clean = D.scrub(matcher, cur);
      if (clean !== cur) {
        originalTitle = cur;
        writtenTitle = clean;
        document.title = clean;
      } else {
        originalTitle = writtenTitle = null;
      }
    } else if (writtenTitle !== null) {
      if (cur === writtenTitle && originalTitle !== null) document.title = originalTitle;
      originalTitle = writtenTitle = null;
    }
  }

  // ---------- full-page curtain ----------

  let curtain = null;
  let curtainGuard = null;

  function buildCurtain() {
    const host = document.createElement('cloakdesk-curtain');
    host.setAttribute(M.UI_ATTR, '');
    // CSSOM (not a style attribute or <style> tag) so strict page CSPs can't block it
    host.style.cssText =
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;padding:0!important;background:#0a0a0a!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    // Near-black drape: soft vertical folds, one quiet message. System fonts: pages can't load the extension's.
    sheet.replaceSync(`
      :host{all:initial}
      .wrap{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;background:#0a0a0a;
        font:14px/1.55 "Geist",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#ededed;
        -webkit-font-smoothing:antialiased}
      .folds{position:absolute;inset:-2px 0 0;
        background:repeating-linear-gradient(90deg,
          rgba(255,255,255,.000) 0px, rgba(255,255,255,.028) 34px, rgba(255,255,255,.000) 68px,
          rgba(0,0,0,.35) 96px, rgba(255,255,255,.000) 120px);
        mask:linear-gradient(180deg,#000 0%,rgba(0,0,0,.55) 55%,transparent 100%)}
      .rod{position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.22),transparent)}
      .msg{position:relative;display:grid;justify-items:center;gap:6px;max-width:360px;padding:24px;text-align:center}
      svg{margin-bottom:14px}
      h1{margin:0;font-size:17px;font-weight:600;letter-spacing:-.02em}
      p{margin:0;color:#a1a1a1}
      .site{margin-top:10px;font:12px ui-monospace,"SF Mono",Menlo,Consolas,monospace;color:#878787}`);
    root.adoptedStyleSheets = [sheet];
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const folds = document.createElement('div');
    folds.className = 'folds';
    const rod = document.createElement('div');
    rod.className = 'rod';
    const msg = document.createElement('div');
    msg.className = 'msg';
    // built node by node: pages with Trusted Types would reject innerHTML
    const NSVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NSVG, 'svg');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const d of ['M3 3.5h18v1.6H3z', 'M4.2 5.1h7.4v15.4H4.2z', 'M12.4 5.1h7.4v15.4h-7.4z']) {
      const path = document.createElementNS(NSVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', '#d9dbe0');
      svg.append(path);
    }
    const h1 = document.createElement('h1');
    h1.textContent = 'Hidden while you share';
    const p = document.createElement('p');
    p.textContent = 'This site is on your Cloak Desk cover list. Use the toolbar button to show it.';
    const siteEl = document.createElement('span');
    siteEl.className = 'site';
    siteEl.textContent = HOST.replace(/^www\./, '');
    msg.append(svg, h1, p, siteEl);
    wrap.append(folds, rod, msg);
    root.append(wrap);
    return host;
  }

  function placeCurtain() {
    if (!curtain || !document.documentElement) return;
    if (!curtain.isConnected) document.documentElement.append(curtain);
    try {
      if (!curtain.matches(':popover-open')) curtain.showPopover();
    } catch (_) {
      /* popover not supported or element not connected yet */
    }
  }

  function applyCurtain() {
    const want = isTop && active && S.hostMatches(HOST, settings.curtainSites);
    if (want && !curtain) {
      curtain = buildCurtain();
      curtain.setAttribute('popover', 'manual');
      placeCurtain();
      curtainGuard = new MutationObserver(placeCurtain);
      curtainGuard.observe(document, { childList: true, subtree: true });
    } else if (!want && curtain) {
      curtainGuard.disconnect();
      curtainGuard = null;
      curtain.remove();
      curtain = null;
    }
  }

  // ---------- screen share events from share-hook.js ----------

  document.addEventListener('cloakdesk:share', (e) => {
    let d;
    try {
      d = JSON.parse(String(e.detail));
    } catch (_) {
      return;
    }
    if (!d || (d.type !== 'start' && d.type !== 'stop') || typeof d.id !== 'string' || d.id.length > 64) return;
    send({ type: 'share', state: d.type, id: d.id });
  });

  window.addEventListener('pagehide', () => send({ type: 'frame-gone' }));

  // Once stylesheets have loaded, layout is known: look again so text in grid/flex cells is split correctly.
  window.addEventListener('load', () => active && masker.rescan(), { once: true });

  // ---------- go ----------

  function shutdown() {
    try {
      masker.stop();
      active = false;
      applyTitle();
      if (curtain) {
        curtain.remove();
        curtain = null;
      }
      if (curtainGuard) curtainGuard.disconnect();
    } catch (_) {
      /* ignore */
    }
    reveal();
  }

  globalThis.__cloakdesk = { shutdown: () => ((orphaned = true), shutdown()) };

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || orphaned) return;
    if (changes[S.KEY]) settings = S.normalize(changes[S.KEY].newValue);
    if (changes[S.RUNTIME_KEY]) sharing = !!(changes[S.RUNTIME_KEY].newValue && changes[S.RUNTIME_KEY].newValue.sharing > 0);
    if (changes[S.KEY] || changes[S.RUNTIME_KEY]) apply();
  });

  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (sender.id !== chrome.runtime.id || !msg) return;
    if (orphaned) return;
    if (msg.type === 'ping') reply({ active, count: masker.count(), intact: masker.intact(), host: HOST });
  });

  chrome.storage.local
    .get([S.KEY, S.RUNTIME_KEY])
    .then((r) => {
      settings = S.normalize(r[S.KEY]);
      sharing = !!(r[S.RUNTIME_KEY] && r[S.RUNTIME_KEY].sharing > 0);
      apply();
    })
    .catch(() => {})
    .finally(reveal);
})();
