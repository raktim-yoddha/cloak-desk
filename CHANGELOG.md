# Changelog

All notable changes to Cloak Desk are listed here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/).
The release workflow publishes the section that matches the pushed tag as the release notes.

## [Unreleased]

### Added
- Windows app (WinUI 3, NativeAOT): presets, curtain color or image, desktop curtain, Stage window for sharing.
- `Ctrl+Alt+C` turns the cloak on or off; `Ctrl+Alt+H` hides or shows the app in front.
- Notification-area icon and menu, start with Windows, single instance.
- Cloak Desk's own windows are excluded from every screen capture.
- Version shown in Settings > About.
- Setup (`CloakDesk-Setup-<version>-<arch>.exe`) for x64 and ARM64: per-user, no admin, installs the Windows App Runtime 1.8 if missing.
- Portable zips and SHA256 checksums on every release.

### Fixed
- Launch crash (`E_NOINTERFACE`) under NativeAOT: presets are now exposed to XAML as proper WinRT types.
- `crash.log` was never written on first run.
- Screen-capture errors no longer close the app; a failed Stage start releases the GPU device.
- The "Hide an app" list no longer fails when a program exits while it loads.

[Unreleased]: https://github.com/raktim-yoddha/cloak-desk/commits/master
