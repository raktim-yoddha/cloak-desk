# Changelog

All notable changes to Cloak Desk are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
The release workflow publishes the section that matches the pushed tag as the release notes.
0.x versions are initial development and are published as pre-releases.

## [Unreleased]

## [0.1.0] - 2026-11-04

First release: Cloak Desk for Windows and the Cloak Desk Browser Safety extension.

### Added

#### Cloak Desk for Windows
- Hide chosen apps from screen shares: Cloak Desk mirrors your screen into a **Cloak Desk Stage** window with a curtain over every window of those apps. Share the Stage in Teams, Zoom, Meet, Discord or OBS; you keep seeing everything.
- `Ctrl+Alt+C` turns the cloak on or off; `Ctrl+Alt+H` hides or shows the app in front of you.
- Presets: named sets of hidden apps, each with a curtain color or image and an optional desktop curtain (wallpaper, icons, taskbar). Saved automatically to `%LOCALAPPDATA%\CloakDesk\presets.json`.
- Tray first: left-click the icon for a compact panel (cloak, preset, hide desktop, start with Windows, open, exit); right-click for a quick menu. Optional start with Windows. Single instance.
- Cloak Desk's own windows never appear in any screen capture.
- Dark interface (WinUI 3): gray-tinted Mica window with acrylic panels, dark even when Windows is in light mode. Version shown in Settings > About.
- Setup for x64 and ARM64 (`CloakDesk-Setup-0.1.0-<arch>.exe`): per-user install, no admin prompt. The app is about 8 MB and uses Microsoft's shared Windows App Runtime 1.8; setup installs the runtime when it's missing. Portable zips and SHA256 checksums.

#### Cloak Desk Browser Safety (Chrome, Edge, Brave)
- Hides emails, phone numbers, payment cards, IBANs, Aadhaar/PAN/SSN/NI numbers, API keys, tokens and passwords, IP addresses, crypto wallets and your own words on every web page while you stream or share. Checksums (Luhn, mod-97, Verhoeff) keep false alarms down.
- Off after install; turn it on from the toolbar, the welcome page or `Alt+Shift+H`. Mode **Always** (for OBS and desktop apps) or **only while this browser shares the screen**, detected automatically.
- Also hides what's typed in sensitive form fields, cleans tab titles, hides notification previews, and can cover whole sites (password managers by default).
- Pages are never modified (covers are painted with the CSS Custom Highlight API); iframes and shadow DOM are covered; new pages stay hidden until scanned; covers survive pages clearing highlights or stylesheets.
- Black-and-graphite interface set in Geist (bundled): layered panels, a live "Viewers see" preview in the toolbar panel, and an example cover on every detection setting. Silver covers by default. Covers also show on your own screen, so you see exactly what viewers see.
- No network code, strict Content Security Policy, settings kept on the device. `CloakDesk-Browser-0.1.0.zip`: unzip and use **Load unpacked** in `chrome://extensions`.

### Known limitations
- Windows: only the primary monitor is mirrored.
- Windows: not code-signed yet, so SmartScreen warns on first run (More info > Run anyway).
- Windows: on some versions a yellow border is drawn around the screen while the cloak is on.
- Extension: not on the Chrome Web Store yet. It can't cover the browser's own UI (address bar, autofill), text in images, PDFs or canvas apps, or other desktop apps.
- macOS and Linux versions are not implemented yet.

[Unreleased]: https://github.com/raktim-yoddha/cloak-desk/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/raktim-yoddha/cloak-desk/releases/tag/v0.1.0
