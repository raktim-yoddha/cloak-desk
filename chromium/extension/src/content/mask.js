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
      'all:initial!important;position:fixed!important;inset:0!important;z-index:2147483647!important;display:block!important;width:100vw!important;height:100vh!important;max-width:none!important;max-height:none!important;margin:0!important;border:0!important;padding:0!important;background:#0d0b16!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(`
      :host{all:initial}
      .wrap{position:absolute;inset:0;display:grid;place-items:center;overflow:hidden;
        font:15px/1.5 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,Roboto,sans-serif;color:#f2f0ff;
        background:radial-gradient(1200px 600px at 15% 10%,rgba(91,69,255,.45),transparent 60%),
                   radial-gradient(900px 600px at 90% 90%,rgba(192,107,255,.35),transparent 60%),#0d0b16}
      .folds{position:absolute;inset:0;background:repeating-linear-gradient(90deg,rgba(255,255,255,.035) 0 2px,transparent 2px 64px),
        repeating-linear-gradient(90deg,rgba(0,0,0,.18) 0 32px,transparent 32px 64px);mask:linear-gradient(#000,transparent 85%)}
      .card{position:relative;text-align:center;padding:36px 44px;max-width:440px;border-radius:24px;
        background:rgba(23,20,42,.72);border:1px solid rgba(255,255,255,.09);box-shadow:0 30px 80px -20px rgba(0,0,0,.6);backdrop-filter:blur(8px)}
      .logo{width:64px;height:64px;margin:0 auto 18px;border-radius:18px;display:grid;place-items:center;
        background:linear-gradient(135deg,#5b45ff,#8b5cf6 55%,#c06bff);box-shadow:0 12px 30px -8px rgba(124,92,255,.7)}
      h1{font:600 22px/1.25 "Segoe UI Variable Display","Segoe UI",system-ui,sans-serif;margin:0 0 8px;letter-spacing:-.01em}
      p{margin:0;color:#b3aed0}
      .site{display:inline-block;margin-top:16px;padding:4px 12px;border-radius:99px;background:rgba(255,255,255,.07);color:#d9d4ff;font-size:13px}`);
    root.adoptedStyleSheets = [sheet];
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    const folds = document.createElement('div');
    folds.className = 'folds';
    const card = document.createElement('div');
    card.className = 'card';
    const logo = document.createElement('div');
    logo.className = 'logo';
    // built node by node: pages with Trusted Types would reject innerHTML
    const NSVG = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NSVG, 'svg');
    svg.setAttribute('width', '34');
    svg.setAttribute('height', '34');
    svg.setAttribute('viewBox', '0 0 24 24');
    for (const d of ['M3 4.5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v.7a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z', 'M4.2 6.2h7.5v14H4.2z', 'M12.3 6.2h7.5v14h-7.5z']) {
      const path = document.createElementNS(NSVG, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', '#fff');
      svg.append(path);
    }
    logo.append(svg);
    const h1 = document.createElement('h1');
    h1.textContent = 'This page is behind the curtain';
    const p = document.createElement('p');
    p.textContent = 'Cloak Desk covers it while you share your screen. Turn it off from the Cloak Desk button in the toolbar.';
    const siteEl = document.createElement('span');
    siteEl.className = 'site';
    siteEl.textContent = HOST.replace(/^www\./, '');
    card.append(logo, h1, p, siteEl);
    wrap.append(folds, card);
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
