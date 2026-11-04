// Renders chromium/assets/icon-*.svg to the PNG sizes the extension ships.
// Run: node chromium/scripts/make-icons.js  (needs Playwright's Chromium)
'use strict';
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const assets = path.join(__dirname, '..', 'assets');
const out = path.join(__dirname, '..', 'extension', 'icons');
const jobs = [
  ['icon-off.svg', 'off', [16, 32, 48]],
  ['icon-armed.svg', 'armed', [16, 32, 48]],
  ['icon-on.svg', 'on', [16, 32, 48]],
  ['icon-on.svg', 'app', [16, 32, 48, 128]],
];

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const [file, name, sizes] of jobs) {
    const svg = fs.readFileSync(path.join(assets, file), 'utf8');
    for (const size of sizes) {
      await page.setViewportSize({ width: size, height: size });
      await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
      await page.screenshot({ path: path.join(out, `${name}-${size}.png`), omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
    }
  }
  await browser.close();
  console.log('icons written to', out);
})();
