# Cloak Desk

Hide chosen apps from screen shares and streams. You keep seeing everything; viewers see a curtain.

Cloak Desk captures your screen, paints a curtain (solid color or image) over every window of the apps you pick (or over the desktop itself), and shows the result in a **Stage** window. In Google Meet, Teams, Zoom, Discord or OBS you share the **Cloak Desk Stage** window instead of the whole screen. Everything else is done with one click or one hotkey.

```
your screen ──capture──▶ curtains over picked apps ──▶ Stage window ──▶ Meet / Zoom / Teams / OBS
     (you see it all)                                   (viewers see this)
```

## Repository layout

| Folder     | What                                       | Status        |
|------------|--------------------------------------------|---------------|
| `windows/` | WinUI 3 app, C# .NET 10 NativeAOT          | Implemented   |
| `macos/`   | SwiftUI/AppKit menu-bar app                | Docs only     |
| `linux/`   | GTK 4 / libadwaita tray app                | Docs only     |
| `docs/`    | Shared design, research, preset format     | All platforms |

Each platform is a separate native app with its own toolchain. They share only the
**preset file format** ([docs/presets.schema.json](docs/presets.schema.json)) and the
behavior described in [docs/architecture.md](docs/architecture.md), so one person
can work on one OS without touching the others.

## Features (all platforms)

- **Presets**: named sets of apps to hide, each with a curtain color or image. Saved automatically.
- **One click or hotkey to cloak**: `Ctrl+Alt+C` turns the Stage on or off with the active preset.
- **Hide the app in front of you**: `Ctrl+Alt+H` adds the app in front to the active preset (or removes it) and saves.
- **Desktop curtain**: hide your wallpaper and desktop icons too.
- **Tray / menu bar resident**: lives in the notification area and starts with the OS if you want.
- **Cloak Desk hides itself**: its own windows never show up in any capture.

## Building

- Windows: see [windows/README.md](windows/README.md).
- macOS: see [macos/README.md](macos/README.md) (not implemented yet).
- Linux: see [linux/README.md](linux/README.md) (not implemented yet).

## Contributing

- Keep each platform self-contained in its folder. No shared code, only the shared docs and schema.
- Any change to the preset format updates `docs/presets.schema.json` and every implemented platform.
- Native frameworks only: no Electron, Tauri, Flutter or other cross-platform UI layers.
