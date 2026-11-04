// Static checks for the extension: manifest integrity and security rules.
// Run: node chromium/scripts/check.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const EXT = path.join(ROOT, 'extension');
const problems = [];
const fail = (msg) => problems.push(msg);

const manifest = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// ---------- manifest ----------

if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
if (manifest.version !== pkg.version) fail(`manifest version ${manifest.version} != package.json ${pkg.version}`);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version)) fail('version must be X.Y.Z');

const allowedPermissions = ['storage', 'scripting', 'contextMenus'];
for (const p of manifest.permissions || []) if (!allowedPermissions.includes(p)) fail(`unexpected permission "${p}" (update check.js and the privacy page if intended)`);
if (manifest.web_accessible_resources) fail('web_accessible_resources lets pages detect and fingerprint the extension');
if (manifest.externally_connectable) fail('externally_connectable must not be set');

const csp = (manifest.content_security_policy || {}).extension_pages || '';
for (const need of ["script-src 'self'", "object-src 'none'", "connect-src 'none'", "base-uri 'none'"]) if (!csp.includes(need)) fail(`CSP is missing ${need}`);
if (/unsafe-(inline|eval)|https?:/.test(csp)) fail('CSP must not allow inline/eval or remote sources');

// every file the manifest points at exists
const referenced = new Set();
const add = (f) => f && referenced.add(f);
Object.values(manifest.icons || {}).forEach(add);
Object.values((manifest.action || {}).default_icon || {}).forEach(add);
add((manifest.action || {}).default_popup);
add((manifest.options_ui || {}).page);
add((manifest.background || {}).service_worker);
for (const cs of manifest.content_scripts || []) [...(cs.js || []), ...(cs.css || [])].forEach(add);
for (const f of referenced) if (!fs.existsSync(path.join(EXT, f))) fail(`manifest references missing file ${f}`);

// files referenced from code (icons, css, scripts)
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const files = walk(EXT);
for (const file of files.filter((f) => /\.(js|html|css)$/.test(f))) {
  const rel = path.relative(EXT, file);
  const src = fs.readFileSync(file, 'utf8');

  for (const m of src.matchAll(/['"(](?:\.\.\/)*((?:icons|src)\/[\w./-]+\.(?:png|js|css|html))/g)) {
    if (!fs.existsSync(path.join(EXT, m[1]))) fail(`${rel} references missing ${m[1]}`);
  }
  for (const m of src.matchAll(/(?:src|href)="(\.\.?\/[^"#?]+)"/g)) {
    if (!fs.existsSync(path.resolve(path.dirname(file), m[1]))) fail(`${rel} links missing ${m[1]}`);
  }

  // ---------- security rules ----------
  if (/\beval\s*\(|new\s+Function\s*\(|setTimeout\(\s*['"`]/.test(src)) fail(`${rel}: no eval / string code`);
  if (/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource/.test(src)) fail(`${rel}: no network calls`);
  if (/<script[^>]*src=["']https?:|<link[^>]*href=["']https?:|@import\s+url\(["']?https?:/.test(src)) fail(`${rel}: no remote scripts or styles`);
  if (/<script(?![^>]*\bsrc=)[^>]*>/.test(src)) fail(`${rel}: no inline scripts`);
  if (/\son[a-z]+\s*=\s*["']/.test(src) && rel.endsWith('.html')) fail(`${rel}: no inline event handlers`);
  if (rel.endsWith('.js') && /innerHTML\s*=/.test(src) && rel !== path.join('src', 'ui', 'icons.js')) fail(`${rel}: innerHTML only in icons.js (static SVG)`);
  if (/chrome\.storage\.sync/.test(src)) fail(`${rel}: settings must stay local (no storage.sync)`);
  // the service worker lives in src/background/, so relative icon paths would resolve there and fail to load
  if (rel === path.join('src', 'background', 'sw.js') && /['"]icons\//.test(src)) fail(`${rel}: icon paths must start with / (extension root)`);
}

if (problems.length) {
  console.error('Extension check failed:\n- ' + problems.join('\n- '));
  process.exit(1);
}
console.log(`Extension check OK: manifest ${manifest.version}, ${files.length} files, ${referenced.size} manifest references`);
