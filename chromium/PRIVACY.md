# Privacy policy: Cloak Desk Browser Safety

Last updated: 2026-11-04

Cloak Desk Browser Safety hides sensitive details on web pages while you share your screen. It is built so that
nothing about you or the pages you visit leaves your computer.

## What it reads

To find sensitive text, the extension reads the text of the pages you open, in your browser, on your device.
That text is only matched against the patterns and words you enabled, to decide what to cover. It is never stored,
logged, copied or sent anywhere.

## What it stores

Your settings (on/off, mode, which kinds of details to hide, your own words and patterns, site lists, look)
are saved in the browser's local extension storage on this device. They are not synced to your Google account
or any other service. Removing the extension deletes them. **Export settings** writes a file only where you choose.

While a tab is sharing your screen, the extension keeps that tab's number in memory and in session storage so
**While sharing** mode works. It is cleared when the share stops or the browser closes.

## What it sends

Nothing. The extension contains no network code, no analytics, no crash reporting and no third-party libraries.
Its own pages and background worker are blocked from making network requests by its Content Security Policy.

## Permissions

| Permission | Why |
|---|---|
| Read and change data on all websites | To find and cover sensitive text on whatever page you show. Pages are not modified; masks are painted on top. |
| `storage` | To remember your settings on this device. |
| `scripting` | To cover tabs that were already open when the extension was installed or updated, and to keep new pages hidden until they are scanned. |
| `contextMenus` | For the right-click actions “Always hide …”, “Cover this site” and “Never hide on this site”. |

## Contact

Questions or issues: https://github.com/raktim-yoddha/cloak-desk/issues
