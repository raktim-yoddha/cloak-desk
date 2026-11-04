# Changelog

All notable changes to Cloak Desk are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
The release workflow publishes the section that matches the pushed tag as the release notes.
0.x versions are initial development and are published as pre-releases.

## [Unreleased]

### Changed
- Windows: dark interface with silver accents, matching the browser extension. Near-black window instead of gray Mica, silver in place of the Windows accent color, quieter settings rows, new black-and-silver app and tray icons (curtain open when off, closed while cloaking).

### Added
- **Cloak Desk Browser Safety**, a Chromium extension (Chrome, Edge, Brave) in `chromium/`. It hides emails, phone numbers, payment cards, IBANs, Aadhaar/PAN/SSN/NI numbers, API keys, tokens and passwords, IP addresses, crypto wallets and your own words on every web page while you stream or share. Checksums (Luhn, mod-97, Verhoeff) keep false alarms down.
- Off after install; turn it on from the toolbar, the welcome page or `Alt+Shift+H`. Mode **Always** (for OBS and desktop apps) or **only while this browser shares the screen**, detected automatically.
- Also hides what's typed in sensitive form fields, cleans tab titles, hides notification previews, and can curtain whole sites (password managers by default).
- Pages are never modified (masks are painted with the CSS Custom Highlight API); iframes and shadow DOM are covered; new pages stay hidden until scanned; masks survive pages clearing highlights or stylesheets.
- Dark, silver-accented interface set in Geist (bundled); silver covers by default. Covers also show on your own screen, so you see exactly what viewers see.
- No network code, strict Content Security Policy, settings kept on the device. Static security checks, detector unit tests and a Chromium end-to-end test run in CI; releases include `CloakDesk-Browser-<version>.zip`.

## [0.1.0] - 2026-11-03

First Windows pre-release.

### Added
- Hide chosen apps from screen shares: Cloak Desk mirrors your screen into a **Cloak Desk Stage** window with a curtain over every window of those apps. Share the Stage in Teams, Zoom, Meet, Discord or OBS; you keep seeing everything.
- `Ctrl+Alt+C` turns the cloak on or off; `Ctrl+Alt+H` hides or shows the app in front of you.
- Presets: named sets of hidden apps, each with a curtain color or image and an optional desktop curtain (wallpaper, icons, taskbar). Saved automatically to `%LOCALAPPDATA%\CloakDesk\presets.json`.
- Notification-area icon and menu: open, cloak, switch preset, exit. Optional start with Windows (in the tray). Single instance.
- Cloak Desk's own windows never appear in any screen capture.
- Windows 11 Settings-style interface (WinUI 3, Mica), light and dark theme. Version shown in Settings > About.
- Setup for x64 and ARM64 (`CloakDesk-Setup-0.1.0-<arch>.exe`): per-user install, no admin prompt, nothing else to install. Portable zips and SHA256 checksums.

### Known limitations
- Only the primary monitor is mirrored.
- Not code-signed yet: Windows SmartScreen warns on first run (More info > Run anyway).
- On some Windows versions a yellow border is drawn around the screen while the cloak is on.
- macOS and Linux versions are not implemented yet.

[Unreleased]: https://github.com/raktim-yoddha/cloak-desk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/raktim-yoddha/cloak-desk/releases/tag/v0.1.0
