// node --test tools/test/*.test.mjs: the watcher's flag files are written again after a failed write (lib/flagSync.ts)
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require = createRequire(new URL('../../app/package.json', import.meta.url));
const {transformSync} = require('esbuild');
const js = transformSync(readFileSync(new URL('../../app/src/lib/flagSync.ts', import.meta.url), 'utf8'), {loader: 'ts', format: 'esm'}).code;
const {flagSync, RETRY_MS} = await import('data:text/javascript,' + encodeURIComponent(js));

/** fake timers plus a writer that fails while `down` */
function rig () {
	const pending = [];
	const st = {down: true, writes: [], pending};
	const timers = {set: (fn, ms) => { const t = {fn, ms}; pending.push(t); return t; }, clear: (t) => { const i = pending.indexOf(t); if (i >= 0) pending.splice(i, 1); }};
	const write = (on) => { st.writes.push(on); return st.down ? Promise.reject(new Error('Timed out')) : Promise.resolve(); };
	const tick = async () => { await new Promise((r) => setImmediate(r)); };
	const fire = async () => { const t = pending.shift(); t.fn(); await tick(); return t.ms; };
	return {st, sync: flagSync(write, timers), tick, fire};
}

test('a write that fails (the Homebrew Channel hung) is tried again, with longer waits, until it lands', async () => {
	const {st, sync, tick, fire} = rig();
	sync.set(true); await tick();
	assert.deepEqual(st.writes, [true]);
	const waits = [await fire(), await fire(), await fire(), await fire(), await fire()];
	assert.deepEqual(waits, [...RETRY_MS, RETRY_MS.at(-1)]);
	st.down = false;
	await fire();
	assert.equal(st.writes.length, 7);
	assert.equal(st.pending.length, 0, 'nothing more once it landed');
});

test('a newer setting replaces the retry, so an old value is never written after it', async () => {
	const {st, sync, tick, fire} = rig();
	sync.set(true); await tick();
	sync.set(false); await tick();
	assert.equal(st.pending.length, 1, 'only the newest value is retried');
	st.down = false;
	await fire();
	assert.deepEqual(st.writes, [true, false, false]);
});

test('one write at a time: a change while a write is out waits for it, and the newest value is the last one written', async () => {
	const writes = [];
	const out = [];
	const write = (on) => { writes.push(on); return new Promise((ok) => out.push(ok)); };
	const timers = {set: () => 0, clear () {}};
	const sync = flagSync(write, timers);
	const tick = () => new Promise((r) => setImmediate(r));
	sync.set(true);
	sync.set(false);
	sync.set(true);
	sync.set(false);
	assert.deepEqual(writes, [true], 'nothing else is sent while the first write is out');
	out.shift()(); await tick();
	assert.deepEqual(writes, [true, false], 'then only the newest value');
	out.shift()(); await tick();
	assert.deepEqual(writes, [true, false], 'and nothing more once it landed');
	sync.resync();
	sync.set(true);
	out.shift()(); await tick();
	out.shift()(); await tick();
	assert.deepEqual(writes, [true, false, false, true]);
});

test('resync writes the latest value again, and does nothing before the first set', async () => {
	const {st, sync, tick} = rig();
	st.down = false;
	sync.resync(); await tick();
	assert.deepEqual(st.writes, []);
	sync.set(true); await tick();
	sync.resync(); await tick();
	assert.deepEqual(st.writes, [true, true]);
});
