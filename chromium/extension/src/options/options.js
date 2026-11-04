'use strict';
(async function () {
  const { settings: S, detectors: D, masker: M, icons: I, store } = globalThis.CloakDesk;
  const $ = (id) => document.getElementById(id);

  I.hydrate(document);

  // ---------- toast ----------

  let toastTimer = 0;
  function toast(text) {
    const t = $('toast');
    t.textContent = text;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // ---------- detectors list ----------

  const list = $('detectorList');
  for (const det of D.list) {
    const row = document.createElement('div');
    row.className = 'row';
    const ic = document.createElement('div');
    ic.className = 'row-ic';
    ic.append(I.el(I.DETECTOR_ICONS[det.id]));
    const text = document.createElement('div');
    text.className = 'row-text';
    const title = document.createElement('div');
    title.className = 'row-title';
    title.textContent = det.label;
    const sub = document.createElement('div');
    sub.className = 'row-sub';
    sub.textContent = det.hint;
    const ex = document.createElement('div');
    ex.className = 'row-example';
    const exText = document.createElement('span');
    exText.className = 'ex';
    exText.textContent = det.example;
    ex.append('e.g.', exText);
    text.append(title, sub, ex);
    const sw = document.createElement('button');
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', det.label);
    sw.dataset.detector = det.id;
    sw.addEventListener('click', () => store.update((s) => ({ detectors: Object.assign({}, s.detectors, { [det.id]: !s.detectors[det.id] }) })));
    row.append(ic, text, sw);
    list.append(row);
  }

  // ---------- tag inputs ----------

  function tagInput({ box, input, read, write, clean, check, cls }) {
    let items = [];
    function draw(next) {
      items = next;
      for (const t of box.querySelectorAll('.tag')) t.remove();
      for (const value of items) {
        const tag = document.createElement('span');
        tag.className = 'tag' + (cls ? ' ' + cls : '');
        const err = check ? check(value) : '';
        if (err) {
          tag.classList.add('bad');
          tag.title = err;
        }
        const label = document.createElement('span');
        label.textContent = value;
        const x = document.createElement('button');
        x.type = 'button';
        x.setAttribute('aria-label', `Remove ${value}`);
        x.append(I.el('x'));
        x.addEventListener('click', () => store.update((s) => write(read(s).filter((v) => v !== value))));
        tag.append(label, x);
        box.insertBefore(tag, input);
      }
    }
    function commit() {
      const raw = input.value;
      const values = (cls === 'pattern' ? [raw] : raw.split(/[\n,]/)).map((v) => (clean ? clean(v) : v.trim())).filter(Boolean);
      if (!values.length) {
        if (raw.trim()) toast('That doesn’t look valid');
        return;
      }
      for (const v of values) {
        const err = check ? check(v) : '';
        if (err) {
          toast(err);
          return;
        }
      }
      input.value = '';
      store.update((s) => write([...read(s), ...values]));
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || (e.key === ',' && cls !== 'pattern')) {
        e.preventDefault();
        commit();
      } else if (e.key === 'Backspace' && !input.value && items.length) {
        const last = items[items.length - 1];
        store.update((s) => write(read(s).filter((v) => v !== last)));
      }
    });
    input.addEventListener('blur', () => input.value.trim() && commit());
    box.addEventListener('click', (e) => e.target === box && input.focus());
    return { draw };
  }

  const words = tagInput({
    box: $('wordsTags'),
    input: $('wordsInput'),
    read: (s) => s.customWords,
    write: (v) => ({ customWords: v }),
    check: (v) => (v.length < 2 ? 'Use at least 2 characters' : ''),
  });
  const patterns = tagInput({
    box: $('patternsTags'),
    input: $('patternsInput'),
    read: (s) => s.customPatterns,
    write: (v) => ({ customPatterns: v }),
    cls: 'pattern',
    check: (v) => {
      try {
        D.parsePattern(v);
        return '';
      } catch (e) {
        return `Pattern error: ${e.message}`;
      }
    },
  });
  const siteClean = (v) => S.normalizeSite(v);
  const curtainTags = tagInput({ box: $('curtainTags'), input: $('curtainInput'), read: (s) => s.curtainSites, write: (v) => ({ curtainSites: v }), clean: siteClean });
  const allowTags = tagInput({ box: $('allowTags'), input: $('allowInput'), read: (s) => s.allowSites, write: (v) => ({ allowSites: v }), clean: siteClean });

  // ---------- look ----------

  const COLORS = [
    ['#4b3bff', 'Violet'],
    ['#15122a', 'Ink'],
    ['#2563eb', 'Blue'],
    ['#0f9d76', 'Teal'],
    ['#e5484d', 'Red'],
    ['#f59e0b', 'Amber'],
    ['#64748b', 'Slate'],
  ];
  const swatches = $('swatches');
  for (const [c, name] of COLORS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-label', name);
    b.title = name;
    b.dataset.color = c;
    b.style.setProperty('--c', c);
    b.addEventListener('click', () => store.update({ color: c }));
    swatches.append(b);
  }
  const custom = document.createElement('label');
  custom.className = 'swatch swatch-custom';
  custom.title = 'Custom color';
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.setAttribute('aria-label', 'Custom color');
  picker.addEventListener('change', () => store.update({ color: picker.value }));
  custom.append(picker);
  swatches.append(custom);

  for (const b of $('styles').querySelectorAll('[data-style]')) b.addEventListener('click', () => store.update({ style: b.dataset.style }));

  // ---------- preview ----------

  const preview = M.createMasker({ doc: document, scope: $('previewBody') });
  let previewMode = 'viewer';
  let lastSettings = null;
  function runPreview() {
    if (!lastSettings) return;
    if (previewMode === 'viewer') {
      preview.start(D.createMatcher(lastSettings), { fields: lastSettings.fields, style: lastSettings.style, color: lastSettings.color });
    } else preview.stop();
  }
  for (const b of document.querySelectorAll('[data-pv]')) {
    b.addEventListener('click', () => {
      previewMode = b.dataset.pv;
      for (const x of document.querySelectorAll('[data-pv]')) x.setAttribute('aria-checked', String(x === b));
      runPreview();
    });
  }

  // ---------- render ----------

  function render({ settings, runtime }) {
    lastSettings = settings;
    const sharing = runtime.sharing > 0;
    const on = settings.enabled && (settings.mode === 'always' || sharing);
    const state = !settings.enabled ? 'off' : on ? (sharing ? 'live' : 'on') : 'armed';

    $('master').setAttribute('aria-checked', String(settings.enabled));
    $('heroCard').dataset.state = state;
    $('masterSub').textContent = {
      off: 'Off. Turn on before you go live.',
      on: 'On. Sensitive details are hidden on every page.',
      live: 'On. A screen share was detected and your details are hidden.',
      armed: 'Ready. Hiding starts when this browser shares your screen.',
    }[state];
    const nav = $('navStatus');
    nav.className = 'nav-status ' + state;
    $('navStatusText').textContent = { off: 'Protection off', on: 'Protection on', live: 'Sharing, protected', armed: 'Ready for sharing' }[state];

    for (const b of $('mode').querySelectorAll('[data-mode]')) b.setAttribute('aria-checked', String(b.dataset.mode === settings.mode));
    for (const b of list.querySelectorAll('[data-detector]')) b.setAttribute('aria-checked', String(!!settings.detectors[b.dataset.detector]));
    for (const b of document.querySelectorAll('[data-key]')) b.setAttribute('aria-checked', String(!!settings[b.dataset.key]));

    words.draw(settings.customWords);
    patterns.draw(settings.customPatterns);
    curtainTags.draw(settings.curtainSites);
    allowTags.draw(settings.allowSites);

    for (const b of $('styles').querySelectorAll('[data-style]')) b.setAttribute('aria-checked', String(b.dataset.style === settings.style));
    let known = false;
    for (const b of swatches.querySelectorAll('[data-color]')) {
      const sel = b.dataset.color === settings.color;
      known = known || sel;
      b.setAttribute('aria-checked', String(sel));
    }
    custom.setAttribute('aria-checked', String(!known));
    if (!known) custom.style.setProperty('--c', settings.color);
    picker.value = settings.color;
    const n = parseInt(settings.color.slice(1), 16);
    document.documentElement.style.setProperty('--mask', settings.color);
    document.documentElement.style.setProperty('--mask-rgb', `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`);

    const welcome = $('welcome');
    if (!settings.onboarded || location.hash === '#welcome') welcome.hidden = false;
    if (settings.enabled) {
      const btn = $('welcomeEnable');
      btn.textContent = '';
      btn.append(I.el('check'), document.createTextNode('Protection is on'));
      welcome.classList.add('done');
    }
    runPreview();
  }

  store.watch(render);

  // ---------- actions ----------

  $('master').addEventListener('click', () => store.update((s) => ({ enabled: !s.enabled, onboarded: true })));
  $('welcomeEnable').addEventListener('click', async () => {
    await store.update({ enabled: true, onboarded: true });
    toast('Protection is on. Try sharing a tab.');
  });
  for (const b of $('mode').querySelectorAll('[data-mode]')) b.addEventListener('click', () => store.update({ mode: b.dataset.mode }));
  for (const b of document.querySelectorAll('[data-key]')) b.addEventListener('click', () => store.update((s) => ({ [b.dataset.key]: !s[b.dataset.key] })));

  $('shortcutBtn').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
  try {
    const c = (await chrome.commands.getAll()).find((x) => x.name === 'toggle-cloak');
    $('shortcutText').textContent = c && c.shortcut ? `${c.shortcut} turns protection on or off` : 'No shortcut set. Pick one in Chrome’s shortcut settings.';
  } catch (_) {
    /* ignore */
  }

  // ---------- backup ----------

  $('exportBtn').addEventListener('click', async () => {
    const { settings } = await store.get();
    const blob = new Blob([JSON.stringify({ app: 'cloak-desk-browser', settings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `cloak-desk-settings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('importBtn').addEventListener('click', () => $('importFile').click());
  $('importFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    try {
      if (file.size > 1e6) throw new Error('too big');
      const data = JSON.parse(await file.text());
      const incoming = S.normalize(data && data.settings ? data.settings : data);
      await store.update((s) => Object.assign(incoming, { enabled: s.enabled, onboarded: true }));
      toast('Settings imported');
    } catch (_) {
      toast('That file isn’t a Cloak Desk settings file');
    }
  });
  $('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset every Cloak Desk setting? Your words and site lists will be removed.')) return;
    await store.update((s) => Object.assign(S.normalize(null), { enabled: s.enabled, onboarded: true }));
    toast('Settings reset');
  });

  $('version').textContent = `Cloak Desk Browser Safety ${chrome.runtime.getManifest().version} · works offline`;

  // ---------- nav highlight ----------

  const links = [...document.querySelectorAll('.nav nav a')];
  const sections = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        for (const a of links) a.classList.toggle('current', a.getAttribute('href') === '#' + e.target.id);
      }
    },
    { rootMargin: '-20% 0px -70% 0px' }
  );
  sections.forEach((s) => io.observe(s));
})();
