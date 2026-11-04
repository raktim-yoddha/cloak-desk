'use strict';
(async function () {
  const { settings: S, detectors: D, icons: I, store } = globalThis.CloakDesk;
  const $ = (id) => document.getElementById(id);

  I.hydrate(document);

  const SHORT = { email: 'Emails', phone: 'Phones', card: 'Cards', iban: 'IBANs', govid: 'IDs', secrets: 'Keys', ip: 'IPs', crypto: 'Wallets' };

  // ---------- tab ----------

  let tab = null;
  let host = '';
  try {
    // ?tab=<id> lets the end-to-end test show the popup for a given tab
    const forced = Number(new URLSearchParams(location.search).get('tab'));
    tab = forced ? await chrome.tabs.get(forced) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    const u = new URL(tab.url || '');
    if (/^(https?|file):$/.test(u.protocol)) host = u.hostname.replace(/^www\./, '');
  } catch (_) {
    /* no tab or no URL access */
  }
  const site = S.normalizeSite(host) || host;

  async function tabCount() {
    if (!tab) return null;
    try {
      const r = await chrome.runtime.sendMessage({ type: 'tab-count', tabId: tab.id });
      if (r && typeof r.count === 'number') return r.count;
    } catch (_) {
      /* worker asleep */
    }
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: 'ping' }, { frameId: 0 });
      return r ? r.count : null;
    } catch (_) {
      return null;
    }
  }

  // ---------- render ----------

  let current = null;
  let countTimer = 0;

  async function render({ settings, runtime }) {
    current = settings;
    const sharing = runtime.sharing > 0;
    const allowed = S.hostMatches(host, settings.allowSites);
    const active = S.isActive(settings, sharing, host);

    $('master').setAttribute('aria-checked', String(settings.enabled));

    const dot = $('dot');
    const text = $('statusText');
    dot.className = 'dot';
    if (!settings.enabled) {
      text.textContent = 'Off';
    } else if (sharing && active) {
      dot.classList.add('live');
      text.textContent = 'Screen share detected';
    } else if (active) {
      dot.classList.add('on');
      text.textContent = 'Hiding sensitive details';
    } else if (allowed && (settings.mode === 'always' || sharing)) {
      text.textContent = `Paused on ${site}`;
    } else {
      dot.classList.add('armed');
      text.textContent = 'Waiting for a screen share';
    }
    if (active && host) {
      const base = text.textContent;
      const showCount = async () => {
        const n = await tabCount();
        if (n != null) text.textContent = base + (n ? ` · ${n} on this page` : ' · nothing on this page');
      };
      await showCount();
      // a page that just turned on reports its count a moment later
      clearTimeout(countTimer);
      countTimer = setTimeout(showCount, 600);
    }
    $('resetShare').hidden = !sharing;

    for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
    $('modeNote').textContent =
      settings.mode === 'always'
        ? 'Use Always for OBS, Zoom or Discord apps. They share from outside the browser.'
        : 'Starts when a tab like Meet or Teams shares your screen, stops when it ends.';

    $('site').hidden = !host;
    $('noSite').hidden = !!host;
    if (host) {
      $('host').textContent = site;
      $('siteSwitch').setAttribute('aria-checked', String(!allowed));
      $('curtainSwitch').setAttribute('aria-checked', String(S.hostMatches(host, settings.curtainSites)));
    }

    const on = D.list.filter((d) => settings.detectors[d.id]).map((d) => SHORT[d.id]);
    const extra = settings.customWords.length + settings.customPatterns.length;
    let summary = on.length === D.list.length ? 'Everything' : on.length ? on.slice(0, 2).join(', ') + (on.length > 2 ? ` +${on.length - 2}` : '') : 'Nothing';
    if (extra) summary += ` · ${extra} word${extra === 1 ? '' : 's'}`;
    $('detectSummary').textContent = summary;
  }

  store.watch(render);

  // ---------- actions ----------

  $('master').addEventListener('click', () => store.update((s) => ({ enabled: !s.enabled, onboarded: true })));

  for (const b of $('mode').querySelectorAll('button')) b.addEventListener('click', () => store.update({ mode: b.dataset.mode }));
  $('mode').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const next = current && current.mode === 'always' ? 'sharing' : 'always';
    store.update({ mode: next }).then(() => $('mode').querySelector(`[data-mode="${next}"]`).focus());
  });

  $('siteSwitch').addEventListener('click', () => {
    if (!site) return;
    store.update((s) => {
      const on = S.hostMatches(host, s.allowSites);
      return { allowSites: on ? s.allowSites.filter((x) => !S.hostMatches(host, [x])) : [...s.allowSites, site] };
    });
  });

  $('curtainSwitch').addEventListener('click', () => {
    if (!site) return;
    store.update((s) => {
      const on = S.hostMatches(host, s.curtainSites);
      return { curtainSites: on ? s.curtainSites.filter((x) => !S.hostMatches(host, [x])) : [...s.curtainSites, site] };
    });
  });

  $('resetShare').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'reset-sharing' }));

  function openSettings(hash) {
    chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') + (hash || '') });
    window.close();
  }
  $('openSettings').addEventListener('click', () => openSettings());
  $('more').addEventListener('click', () => openSettings());
  $('detecting').addEventListener('click', () => openSettings('#detection'));

  // ---------- shortcut ----------

  const sc = $('shortcut');
  try {
    const c = (await chrome.commands.getAll()).find((x) => x.name === 'toggle-cloak');
    if (c && c.shortcut) {
      const keys = document.createElement('span');
      keys.className = 'keys';
      for (const k of c.shortcut.split('+')) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        keys.append(kbd);
      }
      sc.append(keys, 'to toggle');
    } else {
      const b = document.createElement('button');
      b.className = 'link';
      b.textContent = 'Set a shortcut';
      b.addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
      sc.append(b);
    }
  } catch (_) {
    /* ignore */
  }
})();
