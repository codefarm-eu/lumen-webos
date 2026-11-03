// node --test tools/test/*.test.mjs: the Netflix key opens Moonfin and the colour keys call a Home Assistant webhook, through LG Input Hook
// binds that tools/tv/watch.sh keeps (sync_remote_keys) and runs (remote_key). The webhook id is read from a file and never logged.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const STOP = new URL('../../tools/tv/stop_watch.sh', import.meta.url).pathname;
const ID = 'Secret_Webhook-id42';
const bind = (key, code) => `"${code}":{"action":"exec","command":"/bin/sh /var/lib/homehook/watch-key ${key}"}`;
const CODES = {netflix: 1037, red: 398, green: 399, yellow: 400, blue: 401};

function setup ({moonfin = true, id = ID, keybinds = '{"1":{"action":"x"}}\n'} = {}) {
	const dir = mkdtempSync(join(tmpdir(), 'remotekeys-'));
	mkdirSync(join(dir, 'apps'));
	if (moonfin) mkdirSync(join(dir, 'apps', 'org.moonfin.webos'));
	if (id !== null) writeFileSync(join(dir, 'ha-webhook-id'), id + '\n');
	writeFileSync(join(dir, 'keybinds.json'), keybinds);
	const vars = [`WATCH_SH_LIB=1 HOMEHOOK_RUN='${join(dir, 'run')}' HOMEHOOK_HA_ID_FILE='${join(dir, 'ha-webhook-id')}' . '${SCRIPT}'`,
		`APPS='${join(dir, 'apps')}'; KEYBINDS='${join(dir, 'keybinds.json')}'; NONETFLIX_FLAG='${join(dir, 'no-netflix-moonfin')}'`,
		`HOMEKEY_RUN='${join(dir, 'watch-key')}'`];
	const sh = (lines) => execFileSync('sh', ['-c', [...vars, ...lines].join('\n')], {encoding: 'utf8'});
	const log = () => { try { return readFileSync(join(dir, 'run', 'homehook.log'), 'utf8'); } catch { return ''; } };
	const keybinds_ = () => readFileSync(join(dir, 'keybinds.json'), 'utf8');
	return {dir, sh, log, keybinds: keybinds_};
}

test('the key ids: Netflix 1037 opens Moonfin, red/green/yellow/blue 398 to 401 run watch-key <colour>; other binds are kept', () => {
	const t = setup();
	t.sh(['run_dir', 'sync_remote_keys']);
	const kb = JSON.parse(t.keybinds());
	assert.deepEqual(kb['1'], {action: 'x'});
	for (const [key, code] of Object.entries(CODES)) {
		assert.deepEqual(kb[code], {action: 'exec', command: `/bin/sh /var/lib/homehook/watch-key ${key}`}, key);
	}
	assert.equal(Object.keys(kb).length, 6);
	// a second pass changes nothing
	const before = t.keybinds();
	t.sh(['run_dir', 'sync_remote_keys']);
	assert.equal(t.keybinds(), before);
	assert.doesNotMatch(t.log(), new RegExp(ID));
});

test('no webhook id file: the colour keys are not bound (they reach apps as before), and that is logged once', () => {
	const t = setup({id: null});
	t.sh(['run_dir', 'sync_remote_keys', 'sync_remote_keys', 'sync_remote_keys']);
	const kb = JSON.parse(t.keybinds());
	assert.deepEqual(Object.keys(kb).sort(), ['1', '1037']);
	assert.equal(t.log().match(/colour keys: no webhook id/g).length, 1);
});

test('the id file going away unbinds the colour keys; no-netflix-moonfin or no Moonfin unbinds Netflix', () => {
	const t = setup();
	t.sh(['run_dir', 'sync_remote_keys', `rm '${join(t.dir, 'ha-webhook-id')}'`, `touch '${join(t.dir, 'no-netflix-moonfin')}'`, 'sync_remote_keys']);
	assert.equal(t.keybinds(), '{"1":{"action":"x"}}\n');
	const u = setup({moonfin: false, id: null});
	u.sh(['run_dir', 'sync_remote_keys']);
	assert.equal(u.keybinds(), '{"1":{"action":"x"}}\n');
});

test('a bind someone else made on one of these keys is left alone', () => {
	const t = setup({keybinds: '{"1037":{"action":"keycode","keycode":"1"}}\n'});
	t.sh(['run_dir', 'sync_remote_keys']);
	const kb = JSON.parse(t.keybinds());
	assert.deepEqual(kb['1037'], {action: 'keycode', keycode: '1'});
	assert.ok(kb['398']);
});

test('a malformed id (anything but letters, digits, - and _) counts as no id', () => {
	const t = setup({id: 'abc"; rm -rf /'});
	t.sh(['run_dir', 'sync_remote_keys']);
	assert.ok(!JSON.parse(t.keybinds())['398']);
});

/** runs remote_key <key> with curl and luna-send replaced by shell functions that record what they got; waits for the background call */
async function press (key, opts) {
	const t = setup(opts);
	const rec = join(t.dir, 'rec');
	t.sh([`curl () { printf '%s\\n' "$@" > '${rec}.argv'; cat > '${rec}.stdin'; printf 200; }`,
		`lsend () { printf '%s\\n' "$@" >> '${rec}.luna'; echo '{"returnValue":true}'; }`, `remote_key ${key}`]);
	for (let i = 0; i < 100 && !/ key[ :]/.test(t.log()); i++) await new Promise((r) => setTimeout(r, 30));
	const read = (f) => { try { return readFileSync(`${rec}.${f}`, 'utf8'); } catch { return null; } };
	return {log: t.log(), argv: read('argv'), stdin: read('stdin'), luna: read('luna')};
}

test('a colour key POSTs {"key":"<colour>"} to the webhook, 3 s at most; the id is only on curl\'s stdin, never on its command line or in the log', async () => {
	for (const key of ['red', 'green', 'yellow', 'blue']) {
		const r = await press(key);
		assert.equal(r.stdin, `url = "http://192.168.253.244:8123/api/webhook/${ID}"\n`, key);
		const argv = r.argv.split('\n');
		assert.ok(!r.argv.includes(ID), 'id on the command line');
		assert.equal(argv[argv.indexOf('-d') + 1], JSON.stringify({key}));
		assert.equal(argv[argv.indexOf('-m') + 1], '3');
		assert.equal(argv[argv.indexOf('-X') + 1], 'POST');
		assert.match(r.log, new RegExp(`${key} key -> Home Assistant: 200`));
		assert.ok(!r.log.includes(ID), 'id in the log');
	}
});

test('a colour key with no id file sends nothing', async () => {
	const r = await press('red', {id: null});
	assert.equal(r.argv, null);
	assert.match(r.log, /red key: no webhook id, nothing sent/);
});

test('the Netflix key launches Moonfin', async () => {
	const r = await press('netflix');
	assert.match(r.luna, /applicationManager\/launch\n\{"id":"org\.moonfin\.webos"\}/);
	assert.equal(r.argv, null);
});

test('watch-key with an argument runs remote_key, without one home_key (as before)', () => {
	assert.match(readFileSync(SCRIPT, 'utf8'), /case "\$0" in \*\/watch-key\) if \[ -n "\$1" \]; then remote_key "\$1"; else home_key; fi; exit 0 ;; esac/);
});

test('stop_watch.sh removes the Netflix and colour binds and leaves other binds alone', () => {
	const t = setup();
	t.sh(['run_dir', 'sync_remote_keys']);
	const out = execFileSync('sh', [STOP], {encoding: 'utf8', env: {...process.env, HOMEHOOK_WATCH_SH: SCRIPT, HOMEHOOK_KEYBINDS: join(t.dir, 'keybinds.json'),
		HOMEHOOK_RUN: join(t.dir, 'run'), HOMEHOOK_HOSTS: join(t.dir, 'hosts'), HOMEHOOK_IPT_DIRS: join(t.dir, 'none'), HOMEHOOK_PROC: join(t.dir, 'proc')}});
	assert.match(out, /Netflix and colour key binds removed/);
	assert.equal(t.keybinds(), '{"1":{"action":"x"}}\n');
	assert.ok(!existsSync(join(t.dir, 'keybinds.json.tmp')));
});

test('the webhook id is never in the repo\'s TV scripts, and set_ha_webhook.sh does not echo it', () => {
	const src = readFileSync(new URL('../../tools/set_ha_webhook.sh', import.meta.url), 'utf8');
	assert.match(src, /stty -echo/);
	assert.doesNotMatch(src, /echo[^\n]*\$id/);
	assert.doesNotMatch(src, /ssh[^\n]*\$id/);
});
