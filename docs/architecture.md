# Architecture

Shared design for every Cloak Desk port. Platform folders describe how each OS
implements it.

## Goal

The user sees and uses every app normally. People watching a share or stream
don't see the apps the user picked. Turning it on is one click or one hotkey,
from presets saved earlier.

## Research: ways to hide a window from capture

| Approach | How it works | Verdict |
|---|---|---|
| **Capture exclusion flag** (Windows `SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)`, macOS `NSWindow.sharingType = .none`) | The OS leaves the window out of every capture. | Only works on windows **your own process** owns. Cloak Desk uses it on itself. |
| **Load code into other apps** to set that flag (what [HideMyWindows](https://github.com/MehdiMamas/HideMyWindows) does) | A helper library runs inside each target app. | Rejected. Antivirus and anti-cheat flag it, it fails on elevated, protected and Store apps, and it can crash the target app. |
| **Own compositor ("Stage")** | Capture the screen, paint curtains over the target windows' areas, output the result. | **Chosen.** Works for every app, needs no admin rights or drivers, stays inside public OS APIs. |
| **Virtual camera** | Same compositor, but output goes to a virtual webcam. | Possible later add-on. Needs admin registration on Windows 11 (`MFCreateVirtualCamera` + COM source), a DAL/CMIO extension on macOS, v4l2loopback on Linux. |
| **OS thumbnails** (`DwmRegisterThumbnail`) | Shows other windows live inside your window. | Can't rebuild the full desktop with correct z-order. Rejected. |

The trade-off: the user shares the **Stage window** instead of the full screen.
Every major meeting and streaming app supports sharing a single window, and OBS
supports window capture.

## Pipeline

```
monitor capture (GPU texture, ~1 frame)
  └─▶ copy to Stage back buffer
        └─▶ for each visible top-level window, top to bottom:
              if it belongs to a cloaked app:   curtain = window rect − rects of uncloaked windows above it
        └─▶ desktop curtain (optional) = monitor − every visible window
        └─▶ Stage window rect is always curtained (stops the mirror-in-mirror effect)
  └─▶ present
```

- **Z-order matters.** A cloaked window behind an uncloaked one is curtained only
  where it actually shows. Curtains are rectangles minus rectangles
  (`CurtainMath` on Windows; port the same logic elsewhere).
- **Target = app, not window.** Matching by process or bundle name covers the
  app's popups, menus and tooltips automatically.
- **Latency.** Window rectangles are read when each frame arrives, so the curtain
  and frame match. Expect one extra frame of delay (~16 ms at 60 Hz). Curtains
  are padded by a few pixels so a window being dragged fast doesn't leak an edge.
- **Self-hiding.** Cloak Desk's settings window uses the OS capture exclusion flag.
  The Stage window can't use it, because then meeting apps couldn't capture it
  either, so the compositor curtains it instead.
- **Placement.** Keep the Stage on a second monitor, or behind your other windows.
  Covered windows still get captured; minimized ones don't.

## Presets

Stored as JSON in the per-user app data folder:

| OS | Path |
|---|---|
| Windows | `%LOCALAPPDATA%\CloakDesk\presets.json` |
| macOS | `~/Library/Application Support/CloakDesk/presets.json` |
| Linux | `$XDG_CONFIG_HOME/cloakdesk/presets.json` |

Schema: [presets.schema.json](presets.schema.json). Example:

```json
{
  "active": 0,
  "presets": [
    {
      "name": "Work call",
      "apps": ["explorer", "fdm", "windowsterminal"],
      "desktop": true,
      "color": "#202020",
      "image": null
    }
  ]
}
```

`apps` holds lowercase process names without extension (Windows), bundle IDs
(macOS) or executable names (Linux). Moving a file between OSes keeps names,
colors and the desktop flag. App IDs have to be picked again.

## Hotkeys

| Action | Default |
|---|---|
| Turn the Stage on/off with the active preset | `Ctrl+Alt+C` (`⌃⌥C` on macOS) |
| Add or remove the app in front in the active preset, and save | `Ctrl+Alt+H` (`⌃⌥H`) |

## Resource budget

- Idle in tray: no capture, no timers, settings window destroyed (not just hidden).
- Cloaked: one capture stream, one GPU copy plus rectangle fills per frame, no CPU pixel work.
- No web view, no bundled runtime beyond what the OS provides.
