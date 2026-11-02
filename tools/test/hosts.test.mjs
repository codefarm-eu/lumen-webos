// node --test tools/test/*.test.mjs: the watcher's LG host blocking (hosts_sync) and the port 9998 rule (debugger_guard) in tools/tv/watch.sh.
// The script is sourced with WATCH_SH_LIB=1, which stops it before its loops; /etc/hosts, /proc/mounts, the flags and iptables are files
// in a temp folder, and mount is a shell function that prints what it would bind.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const STOP = new URL('../../tools/tv/stop_watch.sh', import.meta.url).pathname;

function setup (hosts = '127.0.0.1 localhost\n') {
	const d = mkdtempSync(join(tmpdir(), 'hosts-'));
	writeFileSync(join(d, 'hosts'), hosts);
	writeFileSync(join(d, 'mounts'), '/dev/root / squashfs ro 0 0\n');
	const env = {HOMEHOOK_HOSTS: join(d, 'hosts'), HOMEHOOK_HOSTS_TABLE: join(d, 'table'), HOMEHOOK_MOUNTS: join(d, 'mounts'),
		HOMEHOOK_NOLGBLOCK_FLAG: join(d, 'no-lg-block'), HOMEHOOK_DEBUGGER_FLAG: join(d, 'debugger-open'),
		HOMEHOOK_DEVMODE_FLAG: join(d, 'devmode_enabled'), HOMEHOOK_IPT_DIRS: join(d, 'sbin'), HOMEHOOK_LOG: join(d, 'log'), HOMEHOOK_RUN: d};
	return {d, env};
}

function run ({d, env}, sh, extra = '') {
	return execFileSync('sh', ['-c', `WATCH_SH_LIB=1 . '${SCRIPT}'\nEXTRA='${join(d, 'hosts-extra')}'\n${extra}\n${sh}`],
		{encoding: 'utf8', env: {...process.env, ...env}}).trim();
}

const names = (t) => run(t, 'lg_block_names').split('\n');

test('the default list: Glasshouse\'s ads tier with its country prefixes, and the firmware servers, each name once', () => {
	const n = names(setup());
	for (const h of ['ad.lgsmartad.com', 'gb.info.lgsmartad.com', 'aic.cdpbeacon.lgtvcommon.com', 'eulacheck.alphonso.tv', 'rone-tv-eic.lge.com',
		'gb.elastic.lgwebostv.com', 'snu.lge.com', 'su-ssl.lge.com']) assert.ok(n.includes(h), h);
	assert.equal(new Set(n).size, n.length);
	for (const h of n) assert.match(h, /^[a-z0-9.-]+\.[a-z]+$/);
});

test('nothing from LG\'s service platform or its clock: the Content Store, app updates and the TV\'s time keep working', () => {
	const n = names(setup());
	for (const h of n) {
		assert.doesNotMatch(h, /(^|\.)(nextlgsdp\.com|wiselg\.com|lgtviot\.com|ueiwsp\.com|avsxappcaptiveportal\.com)$/, h);
		assert.doesNotMatch(h, /(^|\.)ngfts\.lge\.com$|^cdplauncher\.|^lgchhomeapp\./, h);
		// lgtvsdp.com only by its rdx2 report hosts, never the bare or country platform hosts
		if (/lgtvsdp\.com$/.test(h)) assert.match(h, /(^|\.)rdx2\.lgtvsdp\.com$/, h);
		// nor the names the streaming apps, YouTube, Jellyfin or the Homebrew Channel use
		assert.doesNotMatch(h, /youtube|googlevideo|netflix|nflx|jellyfin|moonfin|webosbrew|github/, h);
	}
});

test('hosts_sync adds 0.0.0.0 and :: lines once, and a second pass adds nothing', () => {
	const t = setup();
	run(t, 'hosts_sync');
	const once = readFileSync(t.env.HOMEHOOK_HOSTS, 'utf8');
	assert.match(once, /^127\.0\.0\.1 localhost\n/);
	assert.match(once, /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	assert.match(once, /^:: ad\.lgsmartad\.com$/m);
	assert.equal(once.split('\n').filter((l) => l === '0.0.0.0 ad.lgsmartad.com').length, 1);
	run(t, 'hosts_sync');
	assert.equal(readFileSync(t.env.HOMEHOOK_HOSTS, 'utf8'), once);
	assert.equal(run(t, 'hosts_missing'), '');
	assert.match(readFileSync(t.env.HOMEHOOK_LOG, 'utf8'), /hosts: \d+ lines added/);
});

test('a name the table already answers in that family (the Homebrew Channel\'s update block, another tool\'s redirect) is left as it is', () => {
	const t = setup('127.0.0.1 localhost\n127.0.0.1\tsnu.lge.com su.lge.com # Homebrew Channel\n10.0.0.5 ad.lgsmartad.com\n');
	run(t, 'hosts_sync');
	const h = readFileSync(t.env.HOMEHOOK_HOSTS, 'utf8');
	assert.doesNotMatch(h, /^0\.0\.0\.0 snu\.lge\.com$/m);
	assert.doesNotMatch(h, /^0\.0\.0\.0 su\.lge\.com$/m);
	assert.doesNotMatch(h, /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	assert.match(h, /^:: snu\.lge\.com$/m);
	assert.match(h, /^0\.0\.0\.0 su-ssl\.lge\.com$/m);
});

test('hosts-extra: only "0.0.0.0 <name>" and ":: <name>" lines are taken; no-lg-block keeps only those', () => {
	const t = setup();
	writeFileSync(join(t.d, 'hosts-extra'), '# mine\n0.0.0.0 ads.example.com\n:: ads.example.com\n1.2.3.4 bank.example.com\n0.0.0.0 a.example.com b.example.com\n');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.equal(readFileSync(t.env.HOMEHOOK_HOSTS, 'utf8'), '127.0.0.1 localhost\n0.0.0.0 ads.example.com\n:: ads.example.com\n');
});

test('a read-only /etc/hosts: the table is made from it plus the missing lines and bound over it; bound already, nothing is bound again', {skip: process.getuid?.() === 0 && 'root can write a 444 file'}, () => {
	const t = setup('127.0.0.1 localhost\n0.0.0.0 other.tool.example\n');
	chmodSync(t.env.HOMEHOOK_HOSTS, 0o444);
	const out = run(t, 'hosts_sync; echo "rc=$?"', 'mount () { echo "mount $*"; }');
	assert.equal(out, `mount --bind ${t.env.HOMEHOOK_HOSTS_TABLE} ${t.env.HOMEHOOK_HOSTS}\nrc=0`);
	const table = readFileSync(t.env.HOMEHOOK_HOSTS_TABLE, 'utf8');
	assert.match(table, /^127\.0\.0\.1 localhost\n0\.0\.0\.0 other\.tool\.example\n0\.0\.0\.0 ad\.lgsmartad\.com\n/);
	assert.ok(!existsSync(t.env.HOMEHOOK_HOSTS_TABLE + '.new'));
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/mmcblk0p20 ${t.env.HOMEHOOK_HOSTS} ext4 rw 0 0\n`);
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', 'mount () { echo "mount $*"; }'), 'rc=1');
});

/** fake iptables and ip6tables: -C succeeds while the rule is held (a file), -I adds it, -D removes it; every call is logged */
function fakeIptables (t, tools = ['iptables', 'ip6tables']) {
	const sbin = join(t.d, 'sbin');
	mkdirSync(sbin, {recursive: true});
	for (const n of tools) {
		writeFileSync(join(sbin, n), `#!/bin/sh\necho "${n} $*" >> '${t.d}/calls'\nr='${t.d}/rule-${n}'\n` +
			'case "$1" in -C) [ -f "$r" ] ;; -I) echo "$*" > "$r" ;; -D) rm "$r" ;; esac\n', {mode: 0o755});
	}
	return () => (existsSync(join(t.d, 'calls')) ? readFileSync(join(t.d, 'calls'), 'utf8').trim().split('\n') : []);
}
const RULE = 'INPUT -p tcp --dport 9998 ! -i lo -j DROP';

test('debugger_guard drops 9998 on every interface but loopback, IPv4 and IPv6, once: a second pass only checks', () => {
	const t = setup();
	const calls = fakeIptables(t);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard');
	assert.deepEqual(calls(), [`iptables -C ${RULE}`, `iptables -I ${RULE}`, `ip6tables -C ${RULE}`, `ip6tables -I ${RULE}`]);
	run(t, 'debugger_guard');
	assert.deepEqual(calls().slice(4), [`iptables -C ${RULE}`, `ip6tables -C ${RULE}`]);
	assert.match(readFileSync(t.env.HOMEHOOK_LOG, 'utf8'), /debugger: port 9998 closed/);
	// only port 9998, never ssh (22) or anything else
	for (const c of calls()) assert.match(c, /--dport 9998 ! -i lo -j DROP$/);
});

test('debugger-open takes the rule out; without Developer Mode or a firewall nothing is run', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables']);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard');
	writeFileSync(t.env.HOMEHOOK_DEBUGGER_FLAG, '');
	run(t, 'debugger_guard');
	assert.deepEqual(calls().slice(2), [`iptables -C ${RULE}`, `iptables -D ${RULE}`]);
	assert.ok(!existsSync(join(t.d, 'rule-iptables')));
	const off = setup();
	const offCalls = fakeIptables(off);
	run(off, 'debugger_guard');
	assert.deepEqual(offCalls(), []);
	assert.match(readFileSync(off.env.HOMEHOOK_LOG, 'utf8'), /port 9998 off/);
	const none = setup();
	writeFileSync(none.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(none, 'debugger_guard; debugger_guard');
	assert.equal(readFileSync(none.env.HOMEHOOK_LOG, 'utf8').trim().split('\n').length, 1);
	assert.match(readFileSync(none.env.HOMEHOOK_LOG, 'utf8'), /port 9998 nofirewall/);
});

test('the main loop runs both on its first pass and about every 30 s; stop_watch.sh removes the rule', () => {
	const src = readFileSync(SCRIPT, 'utf8');
	const loop = src.slice(src.indexOf('while true; do\n  # wake'));
	assert.match(loop, /\[ \$\(\(ticks % 30\)\) -eq 1 \] && \{ owned hosts_sync; owned debugger_guard; \}/);
	assert.match(readFileSync(STOP, 'utf8'), /\$t -C \$DEBUGGER_RULE 2>\/dev\/null && \$t -D \$DEBUGGER_RULE/);
});
