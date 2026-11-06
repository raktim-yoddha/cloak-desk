/*
 * Cloak Desk Browser Safety: service worker.
 * - Tracks which tabs are sharing the screen (reported by share-hook.js) for "While sharing" mode.
 * - Keeps the toolbar icon, tooltip and per-tab badge in sync.
 * - Registers prehide.css only while hiding is on, so pages never paint unmasked.
 * - Keyboard shortcut and right-click menu.
 * Makes no network requests.
 */
'use strict';

importScripts('../shared/settings.js', '../shared/detectors.js');

const S = self.CloakDesk.settings;
const PREHIDE_ID = 'cloakdesk-prehide';
const ISOLATED_FILES = ['src/shared/settings.js', 'src/shared/detectors.js', 'src/shared/masker.js', 'src/content/mask.js'];
const MAIN_FILES = ['src/content/share-hook.js'];

// ---------- small helpers ----------

let chain = Promise.resolve();
/** Runs storage read-modify-write steps one at a time. */
function serial(fn) {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function getSettings() {
  const r = await chrome.storage.local.get(S.KEY);
  return S.normalize(r[S.KEY]);
}

function updateSettings(patch) {
  return serial(async () => {
    const cur = await getSettings();
    const next = S.normalize(Object.assign({}, cur, typeof patch === 'function' ? patch(cur) : patch));
    await chrome.storage.local.set({ [S.KEY]: next });
    return next;
  });
}

async function getShares() {
  const r = await chrome.storage.session.get('shares');
  return r.shares || {};
}

async function setShares(shares) {
  const tabs = [...new Set(Object.values(shares).map((s) => s.tabId))];
  await chrome.storage.session.set({ shares });
  const r = await chrome.storage.local.get(S.RUNTIME_KEY);
  const prev = r[S.RUNTIME_KEY] || {};
  const runtime = { sharing: Object.keys(shares).length, tabs };
  if (prev.sharing !== runtime.sharing || JSON.stringify(prev.tabs) !== JSON.stringify(tabs)) {
    await chrome.storage.local.set({ [S.RUNTIME_KEY]: runtime });
  }
}

function editShares(fn) {
  return serial(async () => {
    const shares = await getShares();
    const changed = fn(shares);
    if (changed !== false) await setShares(shares);
  });
}

function hostOf(url) {
  try {
    const u = new URL(url);
    return /^(https?|file):$/.test(u.protocol) ? u.hostname : '';
  } catch (_) {
    return '';
  }
}

// ---------- icon, tooltip, badge ----------

const ICONS = {
  off: { 16: '/icons/off-16.png', 32: '/icons/off-32.png', 48: '/icons/off-48.png' },
  armed: { 16: '/icons/armed-16.png', 32: '/icons/armed-32.png', 48: '/icons/armed-48.png' },
  on: { 16: '/icons/on-16.png', 32: '/icons/on-32.png', 48: '/icons/on-48.png' },
};

async function refreshAction() {
  const settings = await getSettings();
  const r = await chrome.storage.local.get(S.RUNTIME_KEY);
  const sharing = !!(r[S.RUNTIME_KEY] && r[S.RUNTIME_KEY].sharing > 0);
  let state = 'off';
  let title = 'Cloak Desk: off. Click to turn on (Alt+Shift+H)';
  if (settings.enabled && (settings.mode === 'always' || sharing)) {
    state = 'on';
    title = sharing ? 'Cloak Desk: screen share detected, hiding sensitive details' : 'Cloak Desk: hiding sensitive details';
  } else if (settings.enabled) {
    state = 'armed';
    title = 'Cloak Desk: ready, hides details as soon as this browser shares your screen';
  }
  await chrome.action.setIcon({ path: ICONS[state] });
  await chrome.action.setTitle({ title });
  const live = sharing && state === 'on';
  await chrome.action.setBadgeBackgroundColor({ color: live ? '#ff4d4f' : '#ededed' });
  try {
    await chrome.action.setBadgeTextColor({ color: live ? '#ffffff' : '#0a0a0a' });
  } catch (_) {
    /* older Chrome */
  }
  if (state !== 'on' || !settings.badge) {
    counts.clear();
    await chrome.action.setBadgeText({ text: '' });
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.map((t) => chrome.action.setBadgeText({ tabId: t.id, text: '' }).catch(() => {})));
  }
}

/** tabId -> Map(frameId -> count). In memory only; content scripts re-report on change. */
const counts = new Map();

async function setCount(tabId, frameId, n) {
  let frames = counts.get(tabId);
  if (!frames) counts.set(tabId, (frames = new Map()));
  if (n > 0) frames.set(frameId, n);
  else frames.delete(frameId);
  const total = [...frames.values()].reduce((a, b) => a + b, 0);
  const settings = await getSettings();
  const text = settings.badge && total > 0 ? (total > 999 ? '999+' : String(total)) : '';
  await chrome.action.setBadgeText({ tabId, text }).catch(() => {});
}

// ---------- prehide registration ----------

function sitePatterns(sites) {
  const out = [];
  for (const s of sites) out.push(`*://${s}/*`, `*://*.${s}/*`);
  return out;
}

async function syncPrehide() {
  const settings = await getSettings();
  const r = await chrome.storage.local.get(S.RUNTIME_KEY);
  const sharing = !!(r[S.RUNTIME_KEY] && r[S.RUNTIME_KEY].sharing > 0);
  const want = settings.enabled && (settings.mode === 'always' || sharing);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [PREHIDE_ID] });
  const config = {
    id: PREHIDE_ID,
    css: ['src/content/prehide.css'],
    matches: ['<all_urls>'],
    excludeMatches: sitePatterns(settings.allowSites),
    allFrames: true,
    matchOriginAsFallback: true,
    runAt: 'document_start',
    persistAcrossSessions: true,
  };
  if (!want) {
    if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [PREHIDE_ID] });
    return;
  }
  if (!existing.length) {
    await chrome.scripting.registerContentScripts([config]);
    return;
  }
  // update in place: unregister + register would leave a gap where new pages load unprotected
  if (JSON.stringify(existing[0].excludeMatches || []) !== JSON.stringify(config.excludeMatches)) {
    await chrome.scripting.updateContentScripts([{ id: PREHIDE_ID, excludeMatches: config.excludeMatches }]);
  }
}

const syncAll = () =>
  serial(async () => {
    await syncPrehide().catch((e) => console.warn('prehide', e));
    await refreshAction().catch((e) => console.warn('action', e));
  });

// ---------- context menus ----------

function createMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'hide-selection', title: 'Always hide “%s”', contexts: ['selection'] });
    chrome.contextMenus.create({ id: 'curtain-site', title: 'Cover this site completely while hiding', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'allow-site', title: 'Never hide anything on this site', contexts: ['page'] });
  });
}

// Named so the end-to-end test can drive it: Chrome's native menu can't be clicked by automation.
function onMenuClick(info, tab) {
  const host = hostOf(info.pageUrl || (tab && tab.url) || '');
  if (info.menuItemId === 'hide-selection') {
    const text = String(info.selectionText || '').trim().slice(0, 200);
    if (text.length >= 2) updateSettings((s) => ({ customWords: [...s.customWords, text] }));
  } else if (info.menuItemId === 'curtain-site' && host) {
    updateSettings((s) => ({ curtainSites: [...s.curtainSites, S.normalizeSite(host)] }));
  } else if (info.menuItemId === 'allow-site' && host) {
    updateSettings((s) => ({ allowSites: [...s.allowSites, S.normalizeSite(host)] }));
  }
}
chrome.contextMenus.onClicked.addListener(onMenuClick);
self.onMenuClick = onMenuClick;

// ---------- install / startup ----------

async function injectIntoOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of tabs) {
    if (tab.discarded) continue;
    const target = { tabId: tab.id, allFrames: true };
    try {
      await chrome.scripting.executeScript({ target, files: MAIN_FILES, world: 'MAIN', injectImmediately: true });
      await chrome.scripting.executeScript({ target, files: ISOLATED_FILES, injectImmediately: true });
    } catch (_) {
      /* restricted page (Web Store, error page...) */
    }
  }
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const r = await chrome.storage.local.get(S.KEY);
  await chrome.storage.local.set({ [S.KEY]: S.normalize(r[S.KEY]) });
  await chrome.storage.session.set({ shares: {} });
  await chrome.storage.local.set({ [S.RUNTIME_KEY]: { sharing: 0, tabs: [] } });
  createMenus();
  await syncAll();
  if (details.reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html#welcome') });
  // Chrome only adds content scripts to pages loaded after install, so cover tabs that are already open
  if (details.reason === 'install' || details.reason === 'update') injectIntoOpenTabs();
});

chrome.runtime.onStartup.addListener(async () => {
  // shares never survive a browser restart
  await chrome.storage.session.set({ shares: {} });
  await chrome.storage.local.set({ [S.RUNTIME_KEY]: { sharing: 0, tabs: [] } });
  await syncAll();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes[S.KEY] || changes[S.RUNTIME_KEY])) syncAll();
});

// ---------- shortcut ----------

// Named for the same reason: automation can't press browser-level shortcuts.
function onCommand(command) {
  if (command === 'toggle-cloak') updateSettings((s) => ({ enabled: !s.enabled, onboarded: true }));
}
chrome.commands.onCommand.addListener(onCommand);
self.onCommand = onCommand;

// ---------- messages ----------

// The popup and settings page (also when opened in a tab). Content scripts report the page's own URL, never ours.
const fromExtensionPage = (sender) => !!sender.url && sender.url.startsWith(chrome.runtime.getURL(''));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return;
  const tabId = sender.tab && sender.tab.id;
  const frameId = sender.frameId || 0;

  switch (msg.type) {
    case 'share': {
      if (tabId == null || typeof msg.id !== 'string') return;
      const key = `${tabId}:${frameId}:${msg.id.slice(0, 64)}`;
      editShares((shares) => {
        if (msg.state === 'start') shares[key] = { tabId, frameId, since: Date.now() };
        else if (shares[key]) delete shares[key];
        else return false;
      });
      return;
    }
    case 'frame-gone': {
      if (tabId == null) return;
      setCount(tabId, frameId, 0);
      editShares((shares) => {
        let changed = false;
        for (const k of Object.keys(shares)) {
          if (k.startsWith(`${tabId}:${frameId}:`)) {
            delete shares[k];
            changed = true;
          }
        }
        return changed;
      });
      return;
    }
    case 'count': {
      if (tabId == null) return;
      setCount(tabId, frameId, Math.max(0, Math.min(1e6, Number(msg.n) || 0)));
      return;
    }
    case 'tab-count': {
      if (!fromExtensionPage(sender)) return;
      const frames = counts.get(msg.tabId);
      // null = no report yet (e.g. protection was just turned on); the popup then asks the page itself
      reply({ count: frames && frames.size ? [...frames.values()].reduce((a, b) => a + b, 0) : null });
      return;
    }
    case 'reset-sharing': {
      if (!fromExtensionPage(sender)) return;
      editShares((shares) => {
        for (const k of Object.keys(shares)) delete shares[k];
      }).then(() => reply({ ok: true }));
      return true;
    }
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  counts.delete(tabId);
  editShares((shares) => {
    let changed = false;
    for (const k of Object.keys(shares)) {
      if (shares[k].tabId === tabId) {
        delete shares[k];
        changed = true;
      }
    }
    return changed;
  });
});
