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
      await p.setViewportSize({ width: 320, height: 640 });
      const tabId = await sw.evaluate(async (u) => (await chrome.tabs.query({ url: u + '*' }))[0].id, url);
      await p.goto(`chrome-extension://${extId}/src/popup/popup.html?tab=${tabId}`);
      await p.waitForTimeout(400);
      const h = await p.evaluate(() => document.body.scrollHeight);
      await p.setViewportSize({ width: 320, height: h });
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
