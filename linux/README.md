# Cloak Desk for Linux (not implemented)

Read [../docs/architecture.md](../docs/architecture.md) first. This file is the plan for whoever builds the Linux port.

## Stack

| Concern | X11 | Wayland |
|---|---|---|
| UI | GTK 4 + libadwaita (C, Rust gtk-rs, or Vala) | same |
| Screen capture | XComposite / XShm, or the portal below | `xdg-desktop-portal` ScreenCast + PipeWire (DMA-BUF) |
| Window rects + z-order | `_NET_CLIENT_LIST_STACKING`, `_NET_WM_PID`, `XGetWindowAttributes` | **Not exposed by the protocol.** Needs compositor extensions (KWin scripting, GNOME Shell extension, wlroots `foreign-toplevel` has no geometry). |
| Compositing | GL / Vulkan, or GSK on a `GtkGLArea` | same |
| Stage window | Normal GTK window | same |
| Tray | StatusNotifierItem over D-Bus (`libayatana-appindicator`) | same (GNOME needs the AppIndicator extension) |
| Hotkeys | `XGrabKey` | `org.freedesktop.portal.GlobalShortcuts` |
| Self-hiding | Curtain your own window (no exclusion flag on X11) | same |
| Presets | `$XDG_CONFIG_HOME/cloakdesk/presets.json` | same |

## Start here

1. X11 first: every API needed is available.
2. Wayland: start with KDE (KWin exposes window geometry to scripts), then GNOME through a small Shell extension that reports window rects over D-Bus.
3. Optional virtual camera output through `v4l2loopback`.

## Layout to create

```
linux/
  meson.build
  src/
    main.c / main.rs
    stage.*        capture + compositor
    curtain_math.* port of windows/src/CloakDesk/CurtainMath.cs
    presets.*
    tray.*
```

## Packaging

Flatpak (portals give it capture without extra permissions) plus a plain `.deb`.
