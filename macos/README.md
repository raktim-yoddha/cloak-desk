# Cloak Desk for macOS (not implemented)

Read [../docs/architecture.md](../docs/architecture.md) first. This file is the plan for whoever builds the macOS port.

## Stack

| Concern | API |
|---|---|
| UI | SwiftUI + `MenuBarExtra` (macOS 13+), `Settings` scene |
| Screen capture | ScreenCaptureKit: `SCStream` on an `SCDisplay`, `SCContentFilter(display:excludingApplications:[self])` |
| Window rects + z-order | `SCShareableContent.windows` (front to back; `frame`, `owningApplication.bundleIdentifier`, `isOnScreen`) |
| Compositing | Metal: blit the `IOSurface` from each `CMSampleBuffer`, then fill or draw the curtain textures |
| Stage window | `NSWindow` with a `CAMetalLayer` |
| Self-hiding | `NSWindow.sharingType = .none` on the settings window |
| Hotkeys | Carbon `RegisterEventHotKey` (needs no Accessibility permission) |
| Start at login | `SMAppService.mainApp.register()` |
| Presets | `~/Library/Application Support/CloakDesk/presets.json`, `Codable`, same schema |

ScreenCaptureKit can leave whole apps out of a capture natively. Still curtain
them instead: viewers should see clearly that something is hidden, and every
port should behave the same way.

## Permissions

Screen Recording (TCC) is requested on first use of the Stage. Nothing else is needed.

## Layout to create

```
macos/
  CloakDesk.xcodeproj
  CloakDesk/
    CloakDeskApp.swift     MenuBarExtra + Settings
    Stage.swift            SCStream + Metal compositor
    CurtainMath.swift      port of windows/src/CloakDesk/CurtainMath.cs
    Presets.swift
    Hotkeys.swift
```

## Size targets

Universal binary under 5 MB. No dependencies beyond the system frameworks.
