# Cloak Desk for Windows

WinUI 3 app in C# (.NET 10, NativeAOT), unpackaged. Needs Windows 10 2004 or later; Windows 11 for the Mica window background.

## Install

Download `CloakDesk-Setup-<version>-x64.exe` (or `-arm64`) from [Releases](https://github.com/raktim-yoddha/cloak-desk/releases) and run it.
It installs for your user only (no admin prompt). The app itself is about 8 MB: its WinUI interface comes from Microsoft's
shared Windows App Runtime 1.8, installed once per PC and used by other apps too. If your PC doesn't have it yet, setup
downloads it from Microsoft and installs it silently (this needs an internet connection once). Uninstalling Cloak Desk
leaves the runtime in place.
The portable zip needs the runtime too; if it's missing, the app shows Microsoft's prompt to install it.
Prefer no installer? Unzip the `-portable.zip` anywhere and run `CloakDesk.exe`.

Silent install: `CloakDesk-Setup-<version>-x64.exe /VERYSILENT /TASKS="startup"`.

## Build

Requirements: .NET 10 SDK, Visual Studio 2022 with "Desktop development with C++" (NativeAOT links with it).

```powershell
dotnet run --project windows/tests/CurtainMath.Check          # curtain logic checks
dotnet publish windows/src/CloakDesk -c Release -r win-x64 -p:Platform=x64 -o out-x64
```

If publish can't find the linker, put `C:\Program Files (x86)\Microsoft Visual Studio\Installer` (vswhere) on `PATH`.

Installer (Inno Setup 6): `iscc /DAppVersion=1.0.0 /DArch=x64 /DSourceDir=..\..\out-x64 windows\installer\CloakDesk.iss`.

`CLOAKDESK_CAPTURABLE=1` makes the tray panel capturable, for screenshots of the app itself.
Crashes are logged to `%LOCALAPPDATA%\CloakDesk\crash.log`, next to `presets.json`.

## Versioning and releases

The version comes from git tags via [MinVer](https://github.com/adamralph/minver): tag `v1.2.3` builds `1.2.3`, untagged commits build `1.2.4-alpha.0.N`.
It is stamped into the exe's file properties, the tray panel footer and the setup file name.

To release:

1. In `CHANGELOG.md`, move the `## [Unreleased]` entries under a new `## [X.Y.Z] - YYYY-MM-DD` heading.
   The first line under the heading is the release summary; add the `[X.Y.Z]:` link at the bottom.
2. Merge that change to `master`. `.github/workflows/release.yml` then creates the annotated tag `vX.Y.Z`
   (subject from the summary, body from the section), builds x64 and ARM64, runs the full test suite
   (smoke, end-to-end, installer), checks the exe version matches, and publishes the GitHub release with
   `CloakDesk-Setup-X.Y.Z-x64.exe`, `-arm64.exe`, portable zips and `SHA256SUMS.txt`, notes from that section.
   Pushing an annotated tag `vX.Y.Z` yourself runs the same pipeline.
3. 0.x versions and tags with a pre-release suffix are published as GitHub pre-releases.

Cloak Desk is in initial development, so versions are 0.MINOR.PATCH (first release `v0.1.0`):
bump MINOR for new features or `presets.json` changes, PATCH for fixes. 1.0.0 comes once the app is declared stable;
after that, MAJOR is for breaking changes.

The setup and exe are not code-signed yet, so SmartScreen will warn on first run. Signing needs a certificate (for example Azure Trusted Signing) added as a repository secret.
