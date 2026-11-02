# Third-party notices

This is [codefarm-eu/lumen-webos](https://github.com/codefarm-eu/lumen-webos), a fork of [samrenfrew/lumen-webos](https://github.com/samrenfrew/lumen-webos), itself a fork of [ammar027/lumen-webos](https://github.com/ammar027/lumen-webos). [LICENSE](LICENSE) (MIT) is kept as it came.

This repository holds the launcher's source (`app/`), build tools, notes and TV-side scripts. The material below belongs to others.

| Material | Licence | Used for |
|---|---|---|
| [partridgeworks/webos-launcher](https://github.com/partridgeworks/webos-launcher) | MIT, © webos-launcher contributors | the base of `app/`: forked at upstream commit `1e2c39b9a988ceb1b258e40e3592bda84a2aa076` (2026-09-23), with this project's changes committed on top. Upstream's own licence and notices are kept in `app/LICENSE` and `app/THIRD_PARTY_NOTICES.md` |
| [Geist](https://github.com/vercel/geist-font) typeface | SIL Open Font License 1.1, © The Geist Project Authors | `app/src/assets/geist-wght.woff2` (and `tools/branding/`) |
| [Preact](https://preactjs.com) | MIT, © Jason Miller | the UI library (comes with the upstream clone) |
| Geist static cuts (this fork) | SIL Open Font License 1.1, © The Geist Project Authors | `app/src/assets/geist-static-{300..700}.woff2`, fixed-weight instances of `geist-wght.woff2` made with fontTools for engines without variable fonts (webOS 4) |
| [core-js](https://github.com/zloirock/core-js) (this fork) | MIT, © Denis Pushkarev, CoreJS Company | the few polyfills Chromium 53 needs, compiled into `assets/app.js` by `app/vite.config.ts` |
| [Simple Icons](https://simpleicons.org) glyph paths | CC0 | `tools/glyphs.json`, used to draw some app tiles |
| Wallpaper catalogue (`tools/catalog.json`) | links and titles only | points to pictures on Reddit's image host and to their posts; the pictures belong to their authors and are loaded from the internet, not stored here |
| Video wallpaper (`tools/wallpaperVideos.ts`) | links only | streams [Mixkit](https://mixkit.co/license/#videoFree) free stock videos (free use, no attribution needed) and Apple's tvOS aerial screensaver videos from Apple's own server; nothing is stored here or on the TV, and the videos belong to their makers |
| [Glasshouse](https://github.com/rorygallagher2024/glasshouse) host list and firewall rule | MIT, © 2026 Rory Gallagher | `tools/tv/watch.sh`: the LG ad and telemetry names, regional prefixes and fallback countries in `hosts_sync` (from its `server/lib/privacy.js` ads tier), and the port 9998 rule and filter-table check in `debugger_guard` (from its `server/lib/devtools.js`), ported to shell. Its licence is in full below |
| Weather | [Open-Meteo](https://open-meteo.com) (CC BY 4.0), location from [ipwho.is](https://ipwho.is) | optional date/weather line |

App icons, logos and names of third-party apps are trademarks of their owners. They are not included in this repository and this project is not
affiliated with or endorsed by them, or by LG Electronics, Apple Inc. or Samsung. "LG" and "webOS" are trademarks of LG Electronics.

## Glasshouse licence

The LG host list and the port 9998 rule in `tools/tv/watch.sh` are ported from
[Glasshouse](https://github.com/rorygallagher2024/glasshouse), under this licence:

```
MIT License

Copyright (c) 2026 Rory Gallagher

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
