# Cloak Desk for Windows

WinUI 3 app in C# (.NET 10, NativeAOT), unpackaged. Needs Windows 10 2004 or later; Windows 11 for the Mica window background.

## Install

Download `CloakDesk-Setup-<version>-x64.exe` (or `-arm64`) from [Releases](https://github.com/raktim-yoddha/cloak-desk/releases) and run it.
It installs for your user only (no admin prompt). Nothing else is needed: the Windows App SDK runtime is bundled.
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

`CLOAKDESK_CAPTURABLE=1` makes the settings window capturable, for screenshots of the app itself.
Crashes are logged to `%LOCALAPPDATA%\CloakDesk\crash.log`, next to `presets.json`.

## Versioning and releases

The version comes from git tags via [MinVer](https://github.com/adamralph/minver): tag `v1.2.3` builds `1.2.3`, untagged commits build `1.2.4-alpha.0.N`.
It is stamped into the exe's file properties, the Settings > About row and the setup file name.

To release:

1. Move the `## [Unreleased]` entries in `CHANGELOG.md` under `## [1.2.3] - YYYY-MM-DD` and commit.
2. Tag with an annotated tag whose message summarizes the release:
   `git tag -a v1.2.3 -m "Cloak Desk 1.2.3: <one-line summary>"` then `git push origin v1.2.3`.
3. `.github/workflows/release.yml` builds x64 and ARM64, runs the smoke test, checks the exe version matches the tag,
   builds the setups and zips, and publishes a GitHub release with that CHANGELOG section as notes.
   0.x versions and tags with a pre-release suffix are published as GitHub pre-releases.

Cloak Desk is in initial development, so versions are 0.MINOR.PATCH (first release `v0.1.0`):
bump MINOR for new features or `presets.json` changes, PATCH for fixes. 1.0.0 comes once the app is declared stable;
after that, MAJOR is for breaking changes.

The setup and exe are not code-signed yet, so SmartScreen will warn on first run. Signing needs a certificate (for example Azure Trusted Signing) added as a repository secret.
