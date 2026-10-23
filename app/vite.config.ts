import {cpSync, existsSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, normalize, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {defineConfig, loadEnv, type Plugin} from 'vite';
import preact from '@preact/preset-vite';
import autoprefixer from 'autoprefixer';
import {transformAsync} from '@babel/core';
import {build as esbuild} from 'esbuild';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(APP_DIR, '..');

// This fork targets an LG C8 on webOS 4.x, whose web engine is Chromium 53 (docs/webos4.md); upstream targets webOS 6 (Chrome 79) and later.
// What follows was written for Chrome 79 and holds for 53 too. On top of it, for 53: esbuild lowers the syntax (async functions, object
// spread), polyfills() adds the core-js pieces the bundle uses that 53 lacks, and the PostCSS step adds prefixes and font-weight fallbacks.
// webOS 6.x runs Chrome 79. Two things matter for that engine:
//  1. Module scripts (`<script type="module">`) are refused when loaded from file://
//     because the sandbox serves them with no MIME type, so the bundle must be a
//     classic script.
//  2. ES2020 syntax such as `?.` and `??` is a SyntaxError, so everything
//     (dependencies included) is compiled down to the chrome79 target.
const BROWSER_TARGET = 'chrome53';
const BROWSERSLIST = ['chrome 53'];

/** core-js for what the finished bundle uses and Chromium 53 lacks (String#padStart, Promise#finally, ...). Babel only reads the bundle to
 *  find them (usage-global, no syntax changes); they are bundled into one small script put in front of the app, so they are in place before
 *  any app code runs. Web APIs core-js has no polyfill for (ResizeObserver, backdrop-filter) are feature-tested in lib/compat.ts instead. */
/** Detected but left out: replacements of things Chromium 53 has and the app uses only in their plain form (RegExp, URL, JSON, typed arrays
 *  and Promise itself, whose core-js versions are bigger and slower), and iterator helpers, which the scan reports for every `.map`. */
const SKIP_POLYFILL = /\/(es\.typed-array|es\.array-buffer|es\.regexp|es\.string\.(replace|split)|web\.url|es\.json|esnext\.json|es\.iterator\.|es\.promise\.js|web\.dom-exception)/;

function polyfills (): Plugin {
	return {
		name: 'lumen-polyfills',
		apply: 'build',
		enforce: 'post',
		async generateBundle (_options, bundle) {
			for (const file of Object.values(bundle)) {
				if (file.type !== 'chunk' || !file.isEntry) continue;
				const found = await transformAsync(file.code, {
					configFile: false, babelrc: false, sourceType: 'script', compact: true, code: true,
					plugins: [['polyfill-corejs3', {method: 'usage-global', version: '3.51', targets: {chrome: '53'}}]]
				});
				const mods = Array.from(new Set(((found && found.code) || '').match(/core-js\/modules\/[\w.-]+\.js/g) || [])).filter((m) => !SKIP_POLYFILL.test(m)).sort();
				if (!mods.length) continue;
				const out = await esbuild({
					stdin: {contents: mods.map((m) => `import ${JSON.stringify(m)};`).join('\n'), resolveDir: APP_DIR},
					bundle: true, write: false, format: 'iife', target: BROWSER_TARGET, minify: true, legalComments: 'none'
				});
				file.code = `/* core-js ${mods.length} polyfills for Chromium 53 (vite.config.ts polyfills()) */\n${out.outputFiles[0].text}${file.code}`;
				this.info(`polyfills: ${mods.length} core-js modules for ${file.fileName}`);
			}
		}
	};
}

/** Chromium 53 knows only the weights 100, 200 ... 900 (any number came in 62). A weight like 650 is put after a rounded copy, so the old
 *  engine keeps the copy and a newer one the exact weight. */
function fontWeightFallback () {
	return {
		postcssPlugin: 'lumen-font-weight-fallback',
		Declaration: {
			'font-weight': (decl: {value: string; parent?: unknown; prev: () => {prop?: string} | undefined; cloneBefore: (o: object) => void}) => {
				const m = /^(\d+)(\s*!important)?$/.exec(decl.value.trim());
				if (!m || Number(m[1]) % 100 === 0) return;
				const prev = decl.prev();
				if (prev && prev.prop === 'font-weight') return;
				const rounded = Math.min(900, Math.max(100, Math.round(Number(m[1]) / 100) * 100));
				decl.cloneBefore({value: `${rounded}${m[2] || ''}`});
			}
		}
	};
}
fontWeightFallback.postcss = true;

/** Rewrites Vite's module entry tag into a classic deferred script tag. */
function classicScriptTag (): Plugin {
	return {
			name: 'classic-script-tag',
			enforce: 'post',
			transformIndexHtml (html) {
				return html
					.replace(/<script type="module" crossorigin src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
					.replace(/<link rel="stylesheet" crossorigin href="/g, '<link rel="stylesheet" href="');
			}
		};
	}

	/**
	 * Build settings from the repo-root `.env` (see `.env.example`); variables already set in the environment win.
	 *  - LUMEN_APP_ID, LUMEN_APP_TITLE: stamped into dist/appinfo.json and the APP_ID constant. Default: the dev build.
	 *  - LUMEN_PRIVATE=0: build without app/private/ (what the public release is).
	 *  - LUMEN_DEV=1 / 0: a dev build or not (default: dev when the id ends in .dev). Dev builds offer Settings > Frame-rate counter.
	 */
	function lumenSettings (mode: string) {
		const env = loadEnv(mode, REPO_ROOT, 'LUMEN_');
		const privateDir = join(APP_DIR, 'private');
		return {
			appId: env.LUMEN_APP_ID || 'com.ovsteenb.lumen.dev',
			title: env.LUMEN_APP_TITLE || 'Lumen Dev',
			// a dev build (the .dev id, or LUMEN_DEV=1 from the release workflow for branch pushes) offers tools that stable does not
			dev: env.LUMEN_DEV === '1' || (env.LUMEN_DEV !== '0' && /\.dev$/.test(env.LUMEN_APP_ID || 'com.ovsteenb.lumen.dev')),
			privateDir: env.LUMEN_PRIVATE !== '0' && existsSync(privateDir) ? privateDir : ''
		};
	}

	const PRIVATE_MODULE = 'virtual:lumen-private';
	const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

	/**
	 * Personal assets that are never committed or released live in app/private/ (gitignored). Its layout mirrors dist/, and the build lays it over dist/:
	 *   private/iconpack/*.png|jpg|webp   icon tiles, matched to apps by file name (tools/gen_iconpack.py)
	 *   private/icons/apps/<id>.png       extra system app icons
	 *   private/wallpapers/default-N*.jpg your own default wallpapers, with private/wallpapers.json: [{"title": ..., "file": "wallpapers/default-N.jpg"}]
	 *   private/fonts/sf.woff2            the private SF font (tools/make_sf_font.py)
	 * The dev server serves the same files. Without the folder (or with LUMEN_PRIVATE=0) the build is the public one.
	 */
	function lumenPrivate (privateDir: string, appId: string, title: string): Plugin {
		let outDir = 'dist';
		return {
			name: 'lumen-private',
			configResolved (config) { outDir = resolve(config.root, config.build.outDir); },
			resolveId (id) { return id === PRIVATE_MODULE ? '\0' + PRIVATE_MODULE : undefined; },
			load (id) {
				if (id !== '\0' + PRIVATE_MODULE) return undefined;
				const packDir = privateDir && join(privateDir, 'iconpack');
				const pack: Record<string, string> = {};
				if (packDir && existsSync(packDir)) {
					for (const f of readdirSync(packDir).sort()) if (/\.(png|jpe?g|webp)$/i.test(f)) pack[slug(f.replace(/\.[^.]+$/, ''))] = f;
				}
				const wpFile = privateDir && join(privateDir, 'wallpapers.json');
				const wallpapers = wpFile && existsSync(wpFile) ? JSON.parse(readFileSync(wpFile, 'utf8')) : null;
				return `export const ICON_PACK = ${JSON.stringify(pack)};\nexport const PRIVATE_WALLPAPERS = ${JSON.stringify(wallpapers)};\n`;
			},
			configureServer (server) {
				if (!privateDir) return;
				server.middlewares.use((req, res, next) => {
					const path = decodeURIComponent((req.url || '').split('?')[0]);
					const file = normalize(join(privateDir, path));
					if (!file.startsWith(privateDir + '/') || file.endsWith('wallpapers.json') || !existsSync(file) || !statSync(file).isFile()) { next(); return; }
					res.end(readFileSync(file));
				});
			},
			writeBundle () {
				if (privateDir) cpSync(privateDir, outDir, {recursive: true, filter: (src) => !src.endsWith('wallpapers.json') && !src.endsWith('.DS_Store')});
				const infoPath = join(outDir, 'appinfo.json');
				const info = JSON.parse(readFileSync(infoPath, 'utf8'));
				info.id = appId;
				info.title = title;
				writeFileSync(infoPath, JSON.stringify(info, null, 2) + '\n');
			}
		};
	}

	export default defineConfig(({mode}) => {
		const lumen = lumenSettings(mode);
		return {
		base: './',            // the app is loaded from a local file path on the TV
		plugins: [preact(), classicScriptTag(), polyfills(), lumenPrivate(lumen.privateDir, lumen.appId, lumen.title)],
		css: {postcss: {plugins: [autoprefixer({overrideBrowserslist: BROWSERSLIST, grid: false}), fontWeightFallback()]}},
		define: {__LUMEN_APP_ID__: JSON.stringify(lumen.appId), __LUMEN_DEV__: JSON.stringify(mode === 'development' || lumen.dev)},
		build: {
			target: BROWSER_TARGET,
			outDir: 'dist',
			modulePreload: false,
			cssTarget: BROWSER_TARGET,
			rollupOptions: {
				output: {
					format: 'iife',
					inlineDynamicImports: true,
					entryFileNames: 'assets/app.js',
					assetFileNames: 'assets/[name][extname]'
				}
			}
		}
	};
});
