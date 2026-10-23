# Third-party notices

The MIT licence in [LICENSE](LICENSE) covers this project's own code and its app icon
(`public/icon.png`, `public/largeIcon.png`). The following material belongs to others and
is **not** covered by that licence.

## Bundled software

| Component | Licence | Where |
|---|---|---|
| [Preact](https://preactjs.com) | MIT, © Jason Miller | compiled into `assets/app.js`; licence text in [public/licenses/preact-MIT.txt](public/licenses/preact-MIT.txt) |
| [Inter](https://rsms.me/inter/) typeface | SIL Open Font License 1.1, © The Inter Project Authors | `src/assets/inter-latin-wght.woff2`; licence text in [public/licenses/Inter-OFL.txt](public/licenses/Inter-OFL.txt) |
| [Geist](https://github.com/vercel/geist-font) typeface, variable and static cuts | SIL Open Font License 1.1, © The Geist Project Authors | `src/assets/geist-*.woff2`; licence text in [public/licenses/Geist-OFL.txt](public/licenses/Geist-OFL.txt) |
| [core-js](https://github.com/zloirock/core-js) polyfills | MIT, © Denis Pushkarev, CoreJS Company | compiled into `assets/app.js` for Chromium 53 (webOS 4); licence text in [public/licenses/core-js-MIT.txt](public/licenses/core-js-MIT.txt) |

The licence texts are included in the installed app under `licenses/`.

## App and input icons

`public/icons/apps/` contains the icons of third-party TV apps, and `public/icons/inputs/`
contains input-type icons from LG's webOS software. They are trademarks or copyright of
their respective owners. This project is not affiliated with, endorsed by or sponsored by
any of them.

They are included in good faith, only so the launcher can show recognisable tiles for apps
and inputs already installed on the user's own TV. Rights holders who would like an icon
removed can open an issue on this repository and it will be removed. Every app tile falls
back to a plain text tile without its icon, so removal doesn't break anything.

"LG" and "webOS" are trademarks of LG Electronics.
