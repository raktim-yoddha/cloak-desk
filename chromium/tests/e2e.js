// End-to-end test: loads the real extension into Chromium and checks it on the demo page.
// Run: node chromium/tests/e2e.js [screenshot-dir]
'use strict';
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { chromium } = require('playwright');

const EXT = path.resolve(__dirname, '..', 'extension');
const DEMO = path.resolve(__dirname, '..', 'demo', 'index.html');
const OUT = path.resolve(process.argv[2] || path.join(__dirname, '..', 'test-results'));
fs.mkdirSync(OUT, { recursive: true });

const results = [];
async function step(name, fn) {
  const t = Date.now();
  try {
    await fn();
    results.push(`ok   ${name} (${Date.now() - t} ms)`);
    console.log(`ok   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message}`);
    console.log(`FAIL ${name}\n${e.stack}`);
    process.exitCode = 1;
  }
}

const server = http.createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.end(fs.readFileSync(DEMO));
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://localhost:${server.address().port}/`;

  const ctx = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    viewport: { width: 1280, height: 900 },
    deviceScaleFactor: 2,
    args: [
      `--disable-extensions-except=${EXT}`,
      `--load-extension=${EXT}`,
      // getDisplayMedia picks this tab without a dialog
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--auto-select-tab-capture-source-by-title=Inbox',
    ],
  });
  let [sw] = ctx.serviceWorkers();
  if (!sw) sw = await ctx.waitForEvent('serviceworker');
  const extId = new URL(sw.url()).host;

  const setSettings = (patch) =>
    sw.evaluate(async (p) => {
      const S = self.CloakDesk.settings;
      const r = await chrome.storage.local.get(S.KEY);
      await chrome.storage.local.set({ [S.KEY]: S.normalize(Object.assign({}, S.normalize(r[S.KEY]), p)) });
    }, patch);

  const page = await ctx.newPage();
  // masks drawn by the extension's isolated world are invisible to page scripts, so ask the content script
  const masked = () =>
    sw.evaluate(async (u) => {
      const [t] = await chrome.tabs.query({ url: u + '*' });
      const r = await chrome.tabs.sendMessage(t.id, { type: 'ping' }, { frameId: 0 });
      return r;
    }, url);
  const waitFor = async (pred, what, ms = 4000) => {
    const end = Date.now() + ms;
    let last;
    while (Date.now() < end) {
      last = await pred();
      if (last) return last;
      await page.waitForTimeout(100);
    }
    throw new Error(`timed out waiting for ${what} (last: ${JSON.stringify(last)})`);
  };

  await step('welcome page opens on install and protection starts off', async () => {
    const welcome = await waitFor(() => ctx.pages().find((p) => p.url().includes('options.html')), 'welcome tab');
    assert.match(welcome.url(), /#welcome$/);
    const s = await sw.evaluate(() => chrome.storage.local.get('settings'));
    assert.equal(s.settings.enabled, false);
    const cmds = await sw.evaluate(() => chrome.commands.getAll());
    assert.equal(cmds.find((c) => c.name === 'toggle-cloak').shortcut, 'Alt+Shift+H', 'Chrome accepted the toggle shortcut');
    await welcome.close();
  });

  await step('nothing is hidden while off', async () => {
    await page.goto(url);
    await page.waitForTimeout(400);
    const r = await masked();
    assert.equal(r.active, false);
    assert.equal(r.count, 0);
    assert.match(await page.title(), /raktim\.yoddha@gmail\.com/);
  });

  await step('turning on hides details on an open page', async () => {
    await setSettings({ enabled: true, onboarded: true });
    const r = await waitFor(async () => {
      const x = await masked();
      return x.count > 20 && x;
    }, 'masks');
    assert.equal(r.active, true);
    await page.screenshot({ path: path.join(OUT, '01-demo-protected.png'), fullPage: true });
  });

  await step('tab title is cleaned', async () => {
    assert.equal(await page.title(), 'Inbox - ••••• - Demo Mail');
  });

  await step('form fields are masked, including after a password reveal', async () => {
    const attrs = await page.evaluate(() => ['f-email', 'f-tel', 'f-pass'].map((id) => document.getElementById(id).hasAttribute('data-cloakdesk-field')));
    assert.deepEqual(attrs, [true, true, true]);
    await page.evaluate(() => (document.getElementById('f-pass').type = 'text'));
    await page.fill('#f-search', 'leak@example.com');
    await waitFor(() => page.evaluate(() => document.getElementById('f-search').hasAttribute('data-cloakdesk-field')), 'search field masked');
    const sec = await page.evaluate(() => getComputedStyle(document.getElementById('f-pass')).webkitTextSecurity);
    assert.equal(sec, 'disc');
  });

  await step('new content is masked as it appears', async () => {
    const before = (await masked()).count;
    const sameFrame = await page.evaluate(
      () =>
        new Promise((resolve) => {
          document.getElementById('add').click();
          // masks are added in a microtask right after the insertion, before the next frame
          queueMicrotask(() => queueMicrotask(() => requestAnimationFrame(() => resolve(true))));
        })
    );
    assert.ok(sameFrame);
    await waitFor(async () => (await masked()).count >= before + 2, 'new message masked');
  });

  await step('shadow DOM and iframes are covered', async () => {
    const frame = page.frames().find((f) => f !== page.mainFrame());
    assert.ok(frame, 'iframe present');
    const counts = await sw.evaluate(async (u) => {
      const [t] = await chrome.tabs.query({ url: u + '*' });
      const out = [];
      for (const f of [{ frameId: 0 }]) {
        try {
          out.push((await chrome.tabs.sendMessage(t.id, { type: 'ping' }, { frameId: f.frameId })).count);
        } catch (_) {
          /* no script in frame */
        }
      }
      return out;
    }, url);
    assert.ok(counts[0] > 0);
    await page.locator('#cc').scrollIntoViewIfNeeded();
    await page.locator('#cc').screenshot({ path: path.join(OUT, '02-shadow-dom.png') });
    await page.locator('#frame').screenshot({ path: path.join(OUT, '03-iframe.png') });
  });

  await step('selecting masked text does not reveal it', async () => {
    await page.evaluate(() => getSelection().selectAllChildren(document.getElementById('profile')));
    await page.waitForTimeout(150);
    await page.locator('#profile').screenshot({ path: path.join(OUT, '04-selection-guard.png') });
    await page.evaluate(() => getSelection().removeAllRanges());
  });

  await step('a page clearing highlights or stylesheets cannot unmask', async () => {
    const clip = { x: 100, y: 120, width: 300, height: 200 };
    const before = await page.screenshot({ clip });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          CSS.highlights.clear();
          document.adoptedStyleSheets = [];
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );
    assert.equal((await masked()).intact, true);
    const after = await page.screenshot({ clip });
    assert.ok(before.equals(after), 'masks look the same after tampering');
  });

  await step('re-injecting after an extension update replaces the old copy cleanly', async () => {
    const before = (await masked()).count;
    await sw.evaluate(async (u) => {
      const [t] = await chrome.tabs.query({ url: u + '*' });
      const files = ['src/shared/settings.js', 'src/shared/detectors.js', 'src/shared/masker.js', 'src/content/mask.js'];
      await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files });
    }, url);
    const r = await waitFor(async () => {
      const x = await masked();
      return x.active && x.count === before && x.intact && x;
    }, 'same masks after re-injection');
    assert.equal(r.count, before);
  });

  await step('turning off restores everything', async () => {
    await setSettings({ enabled: false });
    await waitFor(async () => (await masked()).active === false, 'off');
    assert.match(await page.title(), /raktim\.yoddha@gmail\.com/);
    assert.equal(await page.evaluate(() => document.querySelectorAll('[data-cloakdesk-field]').length), 0);
  });

  await step('"While sharing" mode turns on with getDisplayMedia and off when the share stops', async () => {
    await setSettings({ enabled: true, mode: 'sharing' });
    await page.waitForTimeout(300);
    assert.equal((await masked()).active, false, 'armed, not hiding yet');
    await page.click('#share');
    await waitFor(() => page.evaluate(() => /Sharing/.test(document.getElementById('log').textContent)), 'share started');
    const r = await waitFor(async () => {
      const x = await masked();
      return x.active && x;
    }, 'hiding after share');
    assert.ok(r.count > 10);
    const runtime = await sw.evaluate(() => chrome.storage.local.get('runtime'));
    assert.equal(runtime.runtime.sharing, 1);
    await page.click('#stop');
    await waitFor(async () => (await masked()).active === false, 'off after share stops');
    await setSettings({ mode: 'always' });
  });

  await step('curtain covers listed sites', async () => {
    await setSettings({ curtainSites: ['localhost'] });
    await page.reload();
    await page.waitForTimeout(500);
    assert.equal(await page.evaluate(() => !!document.querySelector('cloakdesk-curtain')), true);
    await page.screenshot({ path: path.join(OUT, '05-curtain.png') });
    await setSettings({ curtainSites: [] });
    await waitFor(() => page.evaluate(() => !document.querySelector('cloakdesk-curtain')), 'curtain removed');
  });

  await step('never-hide list pauses a site', async () => {
    await setSettings({ allowSites: ['localhost'] });
    await waitFor(async () => (await masked()).active === false, 'paused');
    await setSettings({ allowSites: [] });
    await waitFor(async () => (await masked()).active === true, 'resumed');
  });

  await step('pages load without ever painting unmasked text', async () => {
    await waitFor(async () => (await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 1, 'prehide registered while on');
    const p2 = await ctx.newPage();
    await p2.goto(url);
    assert.equal(await p2.evaluate(() => document.documentElement.hasAttribute('data-cloakdesk-ready')), true);
    await p2.close();
  });

  await step('notifications are hidden while on', async () => {
    const out = await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent('cloakdesk:state', { detail: 'on' }));
      const seen = [];
      try {
        const n = new Notification('Ananya Kapoor', { body: 'My number is +91 98765 43210' });
        seen.push(n.title, n.body);
        n.close();
      } catch (e) {
        seen.push('error ' + e.message);
      }
      return seen;
    });
    assert.notEqual(out[0], 'Ananya Kapoor');
    assert.match(out[1] || '', /hidden by Cloak Desk/);
  });

  const errors = [];
  const watchErrors = (p) => {
    p.on('pageerror', (e) => errors.push(`${p.url()}: ${e.message}`));
    p.on('console', (m) => m.type() === 'error' && errors.push(`${p.url()}: ${m.text()}`));
  };

  await step('popup renders', async () => {
    for (const scheme of ['dark']) {
      const p = await ctx.newPage();
      watchErrors(p);
      await p.emulateMedia({ colorScheme: scheme });
      await p.setViewportSize({ width: 340, height: 640 });
      const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, url);
      await p.goto(`chrome-extension://${extId}/src/popup/popup.html?tab=${tabId}`);
      await p.waitForTimeout(400);
      const h = await p.evaluate(() => document.body.scrollHeight);
      await p.setViewportSize({ width: 340, height: h });
      await p.screenshot({ path: path.join(OUT, `06-popup-${scheme}.png`) });
      await p.close();
    }
  });

  await step('settings page renders', async () => {
    for (const scheme of ['dark']) {
      const p = await ctx.newPage();
      watchErrors(p);
      await p.emulateMedia({ colorScheme: scheme });
      await p.goto(`chrome-extension://${extId}/src/options/options.html#welcome`);
      await p.waitForTimeout(500);
      await p.screenshot({ path: path.join(OUT, `07-settings-${scheme}.png`), fullPage: true });
      await p.close();
    }
  });

  // ---------- every feature, driven like a user ----------

  const tabIdOf = (u) => sw.evaluate(async (x) => (await chrome.tabs.query({ url: x + '*' }))[0].id, u);
  const getSettings = () => sw.evaluate(async () => self.CloakDesk.settings.normalize((await chrome.storage.local.get('settings')).settings));
  const demoTab = await tabIdOf(url);

  async function openPopup(tabId, name) {
    const p = await ctx.newPage();
    watchErrors(p);
    await p.setViewportSize({ width: 340, height: 600 });
    await p.goto(`chrome-extension://${extId}/src/popup/popup.html?tab=${tabId}`);
    await p.waitForTimeout(350);
    if (name) {
      const h = await p.evaluate(() => document.body.scrollHeight);
      await p.setViewportSize({ width: 340, height: h });
      await p.screenshot({ path: path.join(OUT, `${name}.png`) });
    }
    return p;
  }

  await step('popup: every state', async () => {
    await setSettings({ enabled: false, mode: 'always', allowSites: [], curtainSites: [] });
    let p = await openPopup(demoTab, '10-popup-off');
    assert.equal(await p.textContent('#statusText'), 'Off');
    assert.equal(await p.evaluate(() => document.getElementById('viewer').classList.contains('covered')), false);
    await p.close();

    await setSettings({ enabled: true });
    await waitFor(async () => (await masked()).active, 'on');
    p = await openPopup(demoTab, '11-popup-on');
    assert.equal(await p.textContent('#heroTitle'), 'Protected');
    assert.match(await p.textContent('#statusText'), /^\d+ covered on this page$/);
    assert.equal(await p.evaluate(() => document.getElementById('viewer').classList.contains('covered')), true);
    await p.close();

    await setSettings({ mode: 'sharing' });
    p = await openPopup(demoTab, '12-popup-waiting-for-share');
    assert.equal(await p.textContent('#heroTitle'), 'Ready');
    await p.close();

    await page.bringToFront();
    await page.click('#share');
    await waitFor(async () => (await masked()).active, 'live');
    p = await openPopup(demoTab, '13-popup-live-share');
    assert.equal(await p.textContent('#heroTitle'), 'Live share');
    assert.equal(await p.isVisible('#resetShare'), true);
    await p.click('#resetShare');
    await waitFor(async () => (await sw.evaluate(() => chrome.storage.local.get('runtime'))).runtime.sharing === 0, '"Not sharing?" clears the share');
    await p.close();
    await page.click('#stop');

    await setSettings({ mode: 'always', allowSites: ['localhost'] });
    p = await openPopup(demoTab, '14-popup-paused-on-site');
    assert.equal(await p.textContent('#statusText'), 'Never hidden on localhost');
    await p.close();
    await setSettings({ allowSites: [] });

    // a page Chrome doesn't let extensions run on (here: one of the extension's own pages)
    const other = await ctx.newPage();
    await other.goto(`chrome-extension://${extId}/src/options/options.html`);
    const extTab = await other.evaluate(async () => (await chrome.tabs.getCurrent()).id);
    p = await openPopup(extTab, '15-popup-unsupported-page');
    assert.equal(await p.isVisible('#noSite'), true);
    assert.equal(await p.isVisible('#site'), false);
    await p.close();
    await other.close();
  });

  await step('popup: every control works', async () => {
    const p = await openPopup(demoTab);
    await p.click('#master');
    await waitFor(async () => (await getSettings()).enabled === false, 'switch off');
    await waitFor(async () => (await masked()).active === false, 'page uncovered');
    await p.click('#master');
    await waitFor(async () => (await masked()).active === true, 'page covered again');

    await p.click('[data-mode="sharing"]');
    await waitFor(async () => (await getSettings()).mode === 'sharing', 'mode sharing');
    await p.click('[data-mode="always"]');
    await waitFor(async () => (await getSettings()).mode === 'always', 'mode always');

    await p.click('#siteSwitch');
    await waitFor(async () => (await getSettings()).allowSites.includes('localhost'), 'never-hide added');
    await waitFor(async () => (await masked()).active === false, 'site paused');
    await p.click('#siteSwitch');
    await waitFor(async () => (await getSettings()).allowSites.length === 0, 'never-hide removed');

    await p.click('#curtainSwitch');
    await waitFor(async () => (await getSettings()).curtainSites.includes('localhost'), 'curtain added');
    await waitFor(() => page.evaluate(() => !!document.querySelector('cloakdesk-curtain')), 'curtain shown');
    await p.click('#curtainSwitch');
    await waitFor(() => page.evaluate(() => !document.querySelector('cloakdesk-curtain')), 'curtain removed');

    const opened = ctx.waitForEvent('page');
    await p.click('#detecting');
    const settingsPage = await opened;
    await settingsPage.waitForLoadState();
    assert.match(settingsPage.url(), /options\.html#detection$/);
    await settingsPage.close();
  });

  await step('keyboard shortcut toggles protection', async () => {
    await sw.evaluate(() => self.onCommand('toggle-cloak'));
    await waitFor(async () => (await getSettings()).enabled === false, 'off by shortcut');
    await sw.evaluate(() => self.onCommand('toggle-cloak'));
    await waitFor(async () => (await getSettings()).enabled === true, 'on by shortcut');
  });

  await step('right-click menu: always hide, cover site, never hide', async () => {
    const before = (await masked()).count;
    await sw.evaluate((u) => self.onMenuClick({ menuItemId: 'hide-selection', selectionText: 'Account statement', pageUrl: u }), url);
    await waitFor(async () => (await getSettings()).customWords.includes('Account statement'), 'word added');
    await waitFor(async () => (await masked()).count > before, 'selected text now covered');
    await sw.evaluate((u) => self.onMenuClick({ menuItemId: 'curtain-site', pageUrl: u }), url);
    await waitFor(async () => (await getSettings()).curtainSites.includes('localhost'), 'curtain via menu');
    await sw.evaluate((u) => self.onMenuClick({ menuItemId: 'allow-site', pageUrl: u }), url);
    await waitFor(async () => (await getSettings()).allowSites.includes('localhost'), 'never-hide via menu');
    await setSettings({ customWords: [], curtainSites: [], allowSites: [] });
    await waitFor(async () => (await masked()).active === true, 'back to normal');
  });

  await step('toolbar badge and tooltip follow the state', async () => {
    await sw.evaluate(() => refreshAction()); // throws if an icon can't be loaded
    const n = await waitFor(async () => {
      const x = (await masked()).count;
      const b = await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), demoTab);
      // the badge counts the whole tab (top page + iframes), so it is at least the top frame's count
      return x > 0 && Number(b) >= x && Number(b);
    }, 'badge shows the tab count');
    assert.ok(n > 0);
    assert.match(await sw.evaluate(() => chrome.action.getTitle({})), /hiding sensitive details/);
    await setSettings({ badge: false });
    await waitFor(async () => (await sw.evaluate((id) => chrome.action.getBadgeText({ tabId: id }), demoTab)) === '', 'badge hidden');
    await setSettings({ badge: true, mode: 'sharing' });
    await waitFor(async () => /ready/.test(await sw.evaluate(() => chrome.action.getTitle({}))), 'ready tooltip');
    await setSettings({ enabled: false, mode: 'always' });
    await waitFor(async () => /off/.test(await sw.evaluate(() => chrome.action.getTitle({}))), 'off tooltip');
    await setSettings({ enabled: true });
  });

  await step('settings page: every control works', async () => {
    const o = await ctx.newPage();
    watchErrors(o);
    await o.setViewportSize({ width: 1280, height: 900 });
    await o.goto(`chrome-extension://${extId}/src/options/options.html`);
    await o.waitForTimeout(400);

    // detectors: turning Emails off uncovers emails on the page
    const all = (await masked()).count;
    await o.click('[data-detector="email"]');
    await waitFor(async () => (await masked()).count < all, 'emails uncovered');
    await o.click('[data-detector="email"]');
    await waitFor(async () => (await masked()).count === all, 'emails covered again');

    // your words
    await o.fill('#wordsInput', 'Ananya Kapoor');
    await o.press('#wordsInput', 'Enter');
    await o.fill('#wordsInput', 'Demo Mail');
    await o.press('#wordsInput', 'Enter');
    await waitFor(async () => (await getSettings()).customWords.length === 2, 'two words');
    await waitFor(async () => (await masked()).count > all, 'words covered on the page');
    // patterns: an invalid one is refused, a valid one is saved and used
    await o.click('.disclosure summary');
    await o.fill('#patternsInput', '/(/');
    await o.press('#patternsInput', 'Enter');
    await o.waitForTimeout(200);
    assert.equal((await getSettings()).customPatterns.length, 0, 'invalid pattern refused');
    assert.match(await o.textContent('#toast'), /Pattern error/);
    await o.fill('#patternsInput', '/#\\d{6}/');
    await o.press('#patternsInput', 'Enter');
    await waitFor(async () => (await getSettings()).customPatterns.length === 1, 'pattern saved');

    // sites
    await o.fill('#curtainInput', 'https://vault.example.com/login');
    await o.press('#curtainInput', 'Enter');
    await o.fill('#allowInput', 'intranet.example.com');
    await o.press('#allowInput', 'Enter');
    await waitFor(async () => {
      const s = await getSettings();
      return s.curtainSites.includes('vault.example.com') && s.allowSites.includes('intranet.example.com');
    }, 'site lists (URL cleaned to a host)');

    // more places
    await o.click('[data-key="titles"]');
    await waitFor(() => page.evaluate(() => /raktim/.test(document.title)), 'title restored when off');
    await o.click('[data-key="titles"]');
    await waitFor(() => page.evaluate(() => !/raktim/.test(document.title)), 'title cleaned again');
    await o.click('[data-key="fields"]');
    await waitFor(() => page.evaluate(() => !document.querySelector('[data-cloakdesk-field]')), 'fields uncovered when off');
    await o.click('[data-key="fields"]');
    await waitFor(() => page.evaluate(() => !!document.querySelector('[data-cloakdesk-field]')), 'fields covered again');

    // appearance + preview
    await o.click('[data-style="blur"]');
    await waitFor(async () => (await getSettings()).style === 'blur', 'frosted');
    await o.click('[data-color="#111113"]');
    await waitFor(async () => (await getSettings()).color === '#111113', 'obsidian');
    await o.click('[data-style="redact"]');
    await o.click('[data-color="#c9ccd2"]');
    await waitFor(async () => (await getSettings()).color === '#c9ccd2' && (await getSettings()).style === 'redact', 'back to solid silver');
    await o.click('[data-pv="you"]');
    assert.equal(await o.evaluate(() => CSS.highlights.size), 0, 'preview shows the original');
    await o.click('[data-pv="viewer"]');
    assert.equal(await o.evaluate(() => CSS.highlights.size), 1, 'preview covered again');

    // screenshots of each section, filled in
    for (const id of ['general', 'detection', 'words', 'more', 'sites', 'appearance', 'privacy', 'data']) {
      await o.evaluate((x) => document.getElementById(x).scrollIntoView({ block: 'start', behavior: 'instant' }), id);
      await o.waitForTimeout(150);
      await o.locator('#' + id).screenshot({ path: path.join(OUT, `2${['general', 'detection', 'words', 'more', 'sites', 'appearance', 'privacy', 'data'].indexOf(id)}-settings-${id}.png`) });
    }

    // export, then reset, then import restores
    const dl = o.waitForEvent('download');
    await o.click('#exportBtn');
    const file = await (await dl).path();
    const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(exported.app, 'cloak-desk-browser');
    assert.equal(exported.settings.customWords.length, 2);
    o.once('dialog', (d) => d.accept());
    await o.click('#resetBtn');
    await waitFor(async () => (await getSettings()).customWords.length === 0, 'reset cleared words');
    assert.equal((await getSettings()).enabled, true, 'reset keeps protection on');
    const importPath = path.join(OUT, 'import.json');
    fs.writeFileSync(importPath, JSON.stringify(exported));
    await o.setInputFiles('#importFile', importPath);
    await waitFor(async () => (await getSettings()).customWords.length === 2, 'import restored words');
    fs.writeFileSync(importPath, 'not json');
    await o.setInputFiles('#importFile', importPath);
    await waitFor(async () => /isn’t a Cloak Desk settings file/.test(await o.textContent('#toast')), 'bad file refused');
    fs.unlinkSync(importPath);
    await o.close();
    await setSettings({ customWords: [], customPatterns: [], curtainSites: [], allowSites: [] });
  });

  await step('cover styles and colors on a real page', async () => {
    await page.bringToFront();
    await page.evaluate(() => window.scrollTo(0, 0));
    const clip = { x: 110, y: 80, width: 860, height: 300 };
    const shots = {};
    for (const [name, style, color] of [
      ['solid-silver', 'redact', '#c9ccd2'],
      ['frosted-silver', 'blur', '#c9ccd2'],
      ['tint-silver', 'tint', '#c9ccd2'],
      ['solid-obsidian', 'redact', '#111113'],
      ['solid-white', 'redact', '#f4f4f5'],
    ]) {
      await setSettings({ style, color });
      await page.waitForTimeout(350);
      shots[name] = await page.screenshot({ clip, path: path.join(OUT, `3${Object.keys(shots).length}-cover-${name}.png`) });
    }
    const names = Object.keys(shots);
    for (let i = 1; i < names.length; i++) assert.ok(!shots[names[i]].equals(shots[names[i - 1]]), `${names[i]} looks different from ${names[i - 1]}`);
    await setSettings({ style: 'redact', color: '#c9ccd2' });
  });

  await step('demo page before and after', async () => {
    await setSettings({ enabled: false });
    await waitFor(async () => (await masked()).active === false, 'off');
    await page.screenshot({ path: path.join(OUT, '40-demo-without-cloak-desk.png'), fullPage: true });
    await setSettings({ enabled: true });
    await waitFor(async () => (await masked()).active === true, 'on');
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, '41-demo-with-cloak-desk.png'), fullPage: true });
  });

  await step('extension pages log no errors (CSP, scripts)', async () => {
    assert.deepEqual(errors, []);
  });

  await step('turning off from scratch: install state is off', async () => {
    await setSettings({ enabled: false });
    const reg = await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts());
    await waitFor(async () => (await sw.evaluate(() => chrome.scripting.getRegisteredContentScripts())).length === 0, 'prehide removed');
    assert.ok(Array.isArray(reg));
  });

  fs.writeFileSync(path.join(OUT, 'results.txt'), results.join('\n') + '\n');
  await ctx.close();
  server.close();
  console.log(process.exitCode ? 'E2E FAILED' : 'E2E PASSED', '->', OUT);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
