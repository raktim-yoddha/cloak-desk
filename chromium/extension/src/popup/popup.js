'use strict';
(async function () {
  const { settings: S, detectors: D, icons: I, store } = globalThis.CloakDesk;
  const $ = (id) => document.getElementById(id);

  I.hydrate(document);

  const SHORT = { email: 'Emails', phone: 'Phones', card: 'Cards', iban: 'Bank', govid: 'IDs', secrets: 'Keys', ip: 'IPs', crypto: 'Wallets' };

  // ---------- active tab ----------

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

  // ---------- chips ----------

  const chips = $('chips');
  for (const det of D.list) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.id = det.id;
    b.title = `${det.label}: ${det.hint}`;
    b.append(I.el(I.DETECTOR_ICONS[det.id]), document.createTextNode(SHORT[det.id] || det.label));
    b.addEventListener('click', () => store.update((s) => ({ detectors: Object.assign({}, s.detectors, { [det.id]: !s.detectors[det.id] }) })));
    chips.append(b);
  }
  const customChip = document.createElement('button');
  customChip.className = 'chip';
  customChip.append(I.el('text'), document.createTextNode('Your words'));
  customChip.title = 'Names, addresses and anything else you add in settings';
  customChip.addEventListener('click', () => openSettings('#words'));
  chips.append(customChip);

  // ---------- render ----------

  let current = null;

  async function render({ settings, runtime }) {
    current = settings;
    const sharing = runtime.sharing > 0;
    const allowed = S.hostMatches(host, settings.allowSites);
    const active = S.isActive(settings, sharing, host);
    const state = !settings.enabled ? 'off' : active ? 'on' : allowed && (settings.mode === 'always' || sharing) ? 'paused' : 'armed';

    const hero = $('hero');
    hero.dataset.state = state === 'paused' ? 'off' : state;
    $('master').setAttribute('aria-checked', String(settings.enabled));

    const title = $('heroTitle');
    const sub = $('heroSub');
    if (state === 'off') {
      title.textContent = 'Protection is off';
      sub.textContent = 'Turn on to hide emails, numbers and keys on screen';
    } else if (state === 'paused') {
      title.textContent = 'Paused on this site';
      sub.textContent = `${site} is on your never-hide list`;
    } else if (state === 'armed') {
      title.textContent = 'Ready';
      sub.textContent = 'Hides details the moment this browser shares your screen';
    } else {
      title.textContent = sharing ? 'Protecting your share' : 'Protection is on';
      sub.textContent = sharing ? 'Viewers won’t see sensitive details' : 'Sensitive details are hidden on every page';
    }

    $('livePill').hidden = !sharing;
    $('resetShare').hidden = !sharing;

    const pill = $('countPill');
    if (state === 'on' && host) {
      const n = await tabCount();
      pill.hidden = n == null;
      if (n != null) pill.textContent = n === 0 ? 'Nothing sensitive on this page' : `${n} hidden on this page`;
    } else pill.hidden = true;

    for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
    $('modeHint').textContent =
      settings.mode === 'always'
        ? 'Best for OBS, Zoom, Teams or Discord apps: they share your screen from outside the browser.'
        : 'Turns on by itself when Meet, Teams, Zoom or any site in this browser starts sharing.';

    const siteBlock = $('siteBlock');
    if (host) {
      $('siteHost').textContent = site;
      $('siteSwitch').setAttribute('aria-checked', String(!allowed));
      $('curtainSwitch').setAttribute('aria-checked', String(S.hostMatches(host, settings.curtainSites)));
      siteBlock.classList.remove('disabled');
      $('siteNote').hidden = true;
    } else {
      $('siteHost').textContent = '';
      siteBlock.classList.add('disabled');
      $('siteNote').hidden = false;
    }

    for (const b of chips.querySelectorAll('[data-id]')) b.setAttribute('aria-pressed', String(!!settings.detectors[b.dataset.id]));
    customChip.setAttribute('aria-pressed', String(settings.customWords.length + settings.customPatterns.length > 0));
  }

  store.watch(render);

  // ---------- actions ----------

  $('master').addEventListener('click', () => store.update((s) => ({ enabled: !s.enabled, onboarded: true })));

  for (const b of $('mode').querySelectorAll('button')) {
    b.addEventListener('click', () => store.update({ mode: b.dataset.mode }));
  }
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
  $('more').addEventListener('click', (e) => {
    e.preventDefault();
    openSettings();
  });

  // ---------- shortcut ----------

  try {
    const cmds = await chrome.commands.getAll();
    const c = cmds.find((x) => x.name === 'toggle-cloak');
    const sc = $('shortcut');
    if (c && c.shortcut) {
      for (const [i, k] of c.shortcut.split('+').entries()) {
        if (i) sc.append('+');
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        sc.append(kbd);
      }
      sc.append(' on / off');
    } else {
      const a = document.createElement('a');
      a.href = '#';
      a.textContent = 'Set a shortcut';
      a.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
      });
      sc.append(a);
    }
  } catch (_) {
    /* ignore */
  }
})();
