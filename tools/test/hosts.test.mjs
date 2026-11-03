// node --test tools/test/*.test.mjs: the watcher's LG host blocking (hosts_sync) and the port 9998 rule (debugger_guard) in tools/tv/watch.sh,
// and their removal by tools/tv/stop_watch.sh. The script is sourced with WATCH_SH_LIB=1, which stops it before its loops; /etc/hosts,
// /proc/mounts, /proc/net, the flags, iptables and luna-send are files in a temp folder, and mount and umount are shell functions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawn} from 'node:child_process';
import {chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const STOP = new URL('../../tools/tv/stop_watch.sh', import.meta.url).pathname;
const BEGIN = '# >>> Lumen watcher (watch.sh hosts_sync): rebuilt about every 30 s, edits between these lines are lost';
const END = '# <<< Lumen watcher';
// mount and umount are commands in the temp bin (every setup has them), as umount runs under timeout; FAKE_MOUNT is kept for the tests'
// wording only
const FAKE_MOUNT = '';
const SYNC_BIN = '#!/bin/sh\nexit 0\n';

function setup (hosts = '127.0.0.1 localhost\n') {
	const d = mkdtempSync(join(tmpdir(), 'hosts-'));
	writeFileSync(join(d, 'hosts'), hosts);
	writeFileSync(join(d, 'mounts'), '/dev/root / squashfs ro 0 0\n');
	mkdirSync(join(d, 'net'));
	writeFileSync(join(d, 'net', 'ip_tables_names'), 'filter\n');
	writeFileSync(join(d, 'net', 'ip6_tables_names'), 'filter\n');
	mkdirSync(join(d, 'bin'));
	// luna-send answers nothing unless a test gives it an answer
	for (const n of ['mount', 'umount']) {
		writeFileSync(join(d, 'bin', n), `#!/bin/sh\necho "${n} $*" >> '${d}/mounts.log'\n[ ! -f '${d}/${n}-fails' ]\n`, {mode: 0o755});
	}
	writeFileSync(join(d, 'bin', 'sync'), SYNC_BIN, {mode: 0o755});
	writeFileSync(join(d, 'bin', 'luna-send'), `#!/bin/sh\necho "$*" >> '${d}/luna.log'\n[ -f '${d}/luna.answer' ] && cat '${d}/luna.answer'\nexit 0\n`, {mode: 0o755});
	const env = {HOMEHOOK_HOSTS: join(d, 'hosts'), HOMEHOOK_HOSTS_TABLE: join(d, 'table'), HOMEHOOK_MOUNTS: join(d, 'mounts'),
		HOMEHOOK_NOLGBLOCK_FLAG: join(d, 'no-lg-block'), HOMEHOOK_DEBUGGER_FLAG: join(d, 'debugger-open'),
		HOMEHOOK_DEVMODE_FLAG: join(d, 'devmode_enabled'), HOMEHOOK_IPT_DIRS: join(d, 'sbin'), HOMEHOOK_LOG: join(d, 'log'), HOMEHOOK_RUN: d,
		HOMEHOOK_HOSTS_BAK: join(d, 'hosts.bak'), HOMEHOOK_HOSTS_WRITING: join(d, 'hosts.writing'),
		HOMEHOOK_HBC_BLOCK_FLAG: join(d, 'webosbrew_block_updates'), HOMEHOOK_PROC_NET: join(d, 'net'), HOMEHOOK_IPT_SECS: '1',
		PATH: `${join(d, 'bin')}:${process.env.PATH}`};
	return {d, env};
}

function run ({d, env}, sh, extra = '') {
	return execFileSync('sh', ['-c', `WATCH_SH_LIB=1 . '${SCRIPT}'\nEXTRA='${join(d, 'hosts-extra')}'\n${extra}\n${sh}`],
		{encoding: 'utf8', env: {...process.env, ...env}}).trim();
}
const hostsOf = (t) => readFileSync(t.env.HOMEHOOK_HOSTS, 'utf8');
const logOf = (t) => (existsSync(t.env.HOMEHOOK_LOG) ? readFileSync(t.env.HOMEHOOK_LOG, 'utf8') : '');
const mountsLog = (t) => (existsSync(join(t.d, 'mounts.log')) ? readFileSync(join(t.d, 'mounts.log'), 'utf8').trim().split('\n') : []);
const names = (t, sh = 'lg_block_names') => run(t, sh).split('\n');
/** what a hosts file answers for a name, first line wins per family, as the resolver reads it */
function resolve (text, name, fam = 4) {
	for (const raw of text.split('\n')) {
		const f = raw.replace(/#.*/, '').trim().split(/[ \t]+/);
		if (f.length < 2 || (f[0].includes(':') ? 6 : 4) !== fam) continue;
		if (f.slice(1).includes(name)) return f[0];
	}
	return null;
}
const PAST = new Date('2020-01-01T00:00:00Z');

test('the default list: Glasshouse\'s ads tier with its regional and fallback country prefixes, each name once; no firmware servers', () => {
	const n = names(setup());
	for (const h of ['ad.lgsmartad.com', 'gb.info.lgsmartad.com', 'aic.cdpbeacon.lgtvcommon.com', 'eulacheck.alphonso.tv', 'rone-tv-eic.lge.com',
		'gb.elastic.lgwebostv.com', 'fr.wau.lgtvcommon.com', 'eu.info.lgsmartad.com']) assert.ok(n.includes(h), h);
	for (const h of ['snu.lge.com', 'su.lge.com', 'su-dev.lge.com', 'su-ssl.lge.com']) assert.ok(!n.includes(h), h);
	assert.equal(new Set(n).size, n.length);
	for (const h of n) assert.match(h, /^[a-z0-9.-]+\.[a-z]+$/);
});

test('the firmware servers only while the Homebrew Channel\'s "Block system updates" flag is there', () => {
	const t = setup();
	writeFileSync(t.env.HOMEHOOK_HBC_BLOCK_FLAG, '');
	const n = names(t);
	for (const h of ['snu.lge.com', 'su.lge.com', 'su-dev.lge.com', 'su-ssl.lge.com']) assert.ok(n.includes(h), h);
	run(t, 'hosts_sync');
	assert.match(hostsOf(t), /^0\.0\.0\.0 su-ssl\.lge\.com$/m);
	// the checkbox unticked: the next pass lets updates through again
	execFileSync('rm', [t.env.HOMEHOOK_HBC_BLOCK_FLAG]);
	run(t, 'hosts_sync');
	assert.doesNotMatch(hostsOf(t), /\s(snu|su|su-dev|su-ssl)\.lge\.com$/m);
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
});

test('the TV\'s country from the settings service adds its prefix once, with a 5 s limit; the fallback countries stay', () => {
	const t = setup();
	writeFileSync(join(t.d, 'luna.answer'), '{"settings":{"smartServiceCountryCode2":"NL"},"returnValue":true}\n');
	const out = run(t, 'hosts_sync; hosts_sync; echo "$lgcountry $lgcountrytries"; lg_block_names');
	const lines = out.split('\n');
	assert.equal(lines[0], 'nl 1');
	for (const h of ['nl.info.lgsmartad.com', 'nl.cdpbeacon.lgtvcommon.com', 'gb.info.lgsmartad.com', 'us.info.lgsmartad.com']) assert.ok(lines.includes(h), h);
	const calls = readFileSync(join(t.d, 'luna.log'), 'utf8').trim().split('\n');
	assert.equal(calls.length, 1);
	assert.match(calls[0], /com\.webos\.settingsservice\/getSystemSettings \{"category":"option","keys":\["smartServiceCountryCode2"\]\}/);
	assert.match(hostsOf(t), /^0\.0\.0\.0 nl\.info\.lgsmartad\.com$/m);
	assert.match(run(t, 'echo "$T5"'), /^timeout (-t )?1$/);
	// no answer: tried on three passes, then the fallback set alone
	const u = setup();
	assert.equal(run(u, 'hosts_sync; hosts_sync; hosts_sync; hosts_sync; echo "[$lgcountry] $lgcountrytries"'), '[] 3');
	assert.equal(readFileSync(join(u.d, 'luna.log'), 'utf8').trim().split('\n').length, 3);
	assert.ok(names(u).every((h) => !/^[a-z]{2}\./.test(h) || /^(aic|eic|kic|eu|us|gb|au|br|ca|de|fr)\./.test(h) || !/info\.lgsmartad|lgtvcommon|lgwebostv|lgappstv|lgtvsdp/.test(h)));
});

test('nothing from LG\'s service platform or its clock: the Content Store, app updates and the TV\'s time keep working', () => {
	const t = setup();
	writeFileSync(t.env.HOMEHOOK_HBC_BLOCK_FLAG, '');
	for (const h of names(t)) {
		assert.doesNotMatch(h, /(^|\.)(nextlgsdp\.com|wiselg\.com|lgtviot\.com|ueiwsp\.com|avsxappcaptiveportal\.com)$/, h);
		assert.doesNotMatch(h, /(^|\.)ngfts\.lge\.com$|^cdplauncher\.|^lgchhomeapp\./, h);
		assert.notEqual(h, 'lgtvcommon.com');
		// lgtvsdp.com only by its rdx2 report hosts, never the bare or country platform hosts
		if (/lgtvsdp\.com$/.test(h)) assert.match(h, /(^|\.)rdx2\.lgtvsdp\.com$/, h);
		assert.doesNotMatch(h, /youtube|googlevideo|netflix|nflx|jellyfin|moonfin|webosbrew|github/, h);
	}
});

test('hosts_sync writes one block of 0.0.0.0 and :: lines in place (same inode), and a second pass does not write at all', () => {
	const t = setup();
	const ino = statSync(t.env.HOMEHOOK_HOSTS).ino;
	run(t, 'hosts_sync');
	const once = hostsOf(t);
	assert.ok(once.startsWith(`127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ad.lgsmartad.com\n:: ad.lgsmartad.com\n`));
	assert.ok(once.endsWith(`${END}\n`));
	assert.equal(once.split('\n').filter((l) => l === '0.0.0.0 ad.lgsmartad.com').length, 1);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).ino, ino);
	utimesSync(t.env.HOMEHOOK_HOSTS, PAST, PAST);
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), once);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).mtimeMs, PAST.getTime());
	assert.equal(logOf(t).match(/rebuilt in place/g).length, 1);
	assert.ok(!existsSync(join(t.d, 'hosts.new')));
});

test('a stock file with nothing of ours and nothing wanted is not touched', () => {
	const t = setup('127.0.0.1 localhost');   // no newline at the end either
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	utimesSync(t.env.HOMEHOOK_HOSTS, PAST, PAST);
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), '127.0.0.1 localhost');
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).mtimeMs, PAST.getTime());
});

test('a hosts file whose last line has no newline: localhost stays its own line and still resolves', () => {
	const t = setup('127.0.0.1 localhost\n::1 localhost ip6-localhost');
	run(t, 'hosts_sync');
	const h = hostsOf(t);
	assert.ok(h.startsWith(`127.0.0.1 localhost\n::1 localhost ip6-localhost\n${BEGIN}\n`));
	assert.equal(resolve(h, 'localhost', 4), '127.0.0.1');
	assert.equal(resolve(h, 'localhost', 6), '::1');
	assert.equal(resolve(h, 'ad.lgsmartad.com', 4), '0.0.0.0');
	assert.equal(resolve(h, 'ip6-localhost', 6), '::1');
});

test('no-lg-block: the LG lines already there go on the next pass, in place; localhost, the Homebrew Channel\'s and other lines stay', () => {
	const pre = '127.0.0.1 localhost\n127.0.0.1\tsnu.lge.com su.lge.com # Homebrew Channel\n192.0.2.5 my.lan.example\n';
	const t = setup(pre);
	writeFileSync(t.env.HOMEHOOK_HBC_BLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	const ino = statSync(t.env.HOMEHOOK_HOSTS).ino;
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), pre);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).ino, ino);
	// lines outside a block are not this watcher's, whatever name they hold: they stay
	const pre2 = '127.0.0.1 localhost\n0.0.0.0 ad.lgsmartad.com\n:: ad.lgsmartad.com\n0.0.0.0 su.lge.com\n192.0.2.9 smartad.lge.com\n';
	const old = setup(pre2);
	writeFileSync(old.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(old, 'hosts_sync');
	assert.equal(hostsOf(old), pre2);
});

test('a name another line already answers in that family is not repeated; the older 40-lg-privacy-hosts hook\'s lines are left as they are', () => {
	// that hook (not from this repository) sends names to 127.0.0.1, some of which break the Content Store: it is to be removed from the TV
	// by hand (PLAN.md), and until then its lines are foreign here, never rewritten or dropped
	const hook = '127.0.0.1 lgtvsdp.com\n127.0.0.1 uk.lgtvsdp.com\n127.0.0.1 ngfts.lge.com\n127.0.0.1 lgtvcommon.com\n127.0.0.1 nexlgsdp.com\n127.0.0.1 ad.lgsmartad.com\n';
	const t = setup(`127.0.0.1 localhost\n${hook}192.0.2.5 smartad.lge.com\n`);
	run(t, 'hosts_sync');
	const h = hostsOf(t);
	assert.ok(h.startsWith(`127.0.0.1 localhost\n${hook}192.0.2.5 smartad.lge.com\n${BEGIN}\n`));
	assert.doesNotMatch(h, /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	assert.match(h, /^:: ad\.lgsmartad\.com$/m);
	assert.doesNotMatch(h, /^0\.0\.0\.0 smartad\.lge\.com$/m);
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), `127.0.0.1 localhost\n${hook}192.0.2.5 smartad.lge.com\n`);
});

test('hosts-extra: only "0.0.0.0 <name>" and ":: <name>" lines are taken; no-lg-block keeps only those; a name dropped from it goes', () => {
	const t = setup();
	writeFileSync(join(t.d, 'hosts-extra'), '# mine\n0.0.0.0 ads.example.com\n:: ads.example.com\n1.2.3.4 bank.example.com\n0.0.0.0 a.example.com b.example.com\n');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), `127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ads.example.com\n:: ads.example.com\n${END}\n`);
	writeFileSync(join(t.d, 'hosts-extra'), '');
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
});

test('a writable tmpfs bind over /etc/hosts (this TV) is rebuilt in place, not bound over again', () => {
	const t = setup('127.0.0.1 localhost\n');
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/root / squashfs ro 0 0\ntmpfs ${t.env.HOMEHOOK_HOSTS} tmpfs rw,relatime 0 0\n`);
	const ino = statSync(t.env.HOMEHOOK_HOSTS).ino;
	run(t, 'hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(t), []);
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).ino, ino);
	assert.ok(!existsSync(t.env.HOMEHOOK_HOSTS_TABLE));
});

test('hosts_bound matches the mount point exactly: a similar path never counts, so a bind is never stacked or missed', () => {
	const t = setup();
	const h = t.env.HOMEHOOK_HOSTS;
	for (const [line, want] of [[`tmpfs ${h} tmpfs rw 0 0`, 'yes'], [`tmpfs ${h}.bak tmpfs rw 0 0`, 'no'], [`tmpfs ${h.replace(/\.?hosts$/, 'Xhosts')} tmpfs rw 0 0`, 'no'],
		[`tmpfs /x${h} tmpfs rw 0 0`, 'no'], [`${h} /mnt tmpfs rw 0 0`, 'no']]) {
		writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/root / squashfs ro 0 0\n${line}\n`);
		assert.equal(run(t, 'hosts_bound && echo yes || echo no'), want, line);
	}
	const dots = setup();
	dots.env.HOMEHOOK_HOSTS = '/etc/hosts';
	writeFileSync(dots.env.HOMEHOOK_MOUNTS, 'tmpfs /etcXhosts tmpfs rw 0 0\ntmpfs /etc/hostsX tmpfs rw 0 0\n');
	assert.equal(run(dots, 'hosts_bound && echo yes || echo no'), 'no');
});

const roSkip = {skip: process.getuid?.() === 0 && 'root can write a 444 file'};

test('a read-only /etc/hosts: the table is made from it and bound over it once; then it is the bound table that is rebuilt in place', roSkip, () => {
	const t = setup('127.0.0.1 localhost\n0.0.0.0 other.tool.example');
	chmodSync(t.env.HOMEHOOK_HOSTS, 0o444);
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', FAKE_MOUNT), 'rc=0');
	assert.deepEqual(mountsLog(t), [`mount --bind ${t.env.HOMEHOOK_HOSTS_TABLE} ${t.env.HOMEHOOK_HOSTS}`]);
	const table = readFileSync(t.env.HOMEHOOK_HOSTS_TABLE, 'utf8');
	assert.ok(table.startsWith(`127.0.0.1 localhost\n0.0.0.0 other.tool.example\n${BEGIN}\n0.0.0.0 ad.lgsmartad.com\n`));
	assert.ok(existsSync(join(t.d, 'hosts-bound')));
	// bound by someone else and still read-only: left alone, nothing bound again
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `tmpfs ${t.env.HOMEHOOK_HOSTS} tmpfs ro 0 0\n`);
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', FAKE_MOUNT), 'rc=1');
	assert.equal(mountsLog(t).length, 1);
	assert.match(logOf(t), /is bound and cannot be written/);
});

test('a failed bind does not write the table on flash every pass: backed off, and on the retry written only if its bytes changed', roSkip, () => {
	const t = setup();
	chmodSync(t.env.HOMEHOOK_HOSTS, 0o444);
	writeFileSync(join(t.d, 'mount-fails'), '');
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', FAKE_MOUNT), 'rc=1');
	assert.match(logOf(t), /could not bind .* next try in 1800 s/);
	utimesSync(t.env.HOMEHOOK_HOSTS_TABLE, PAST, PAST);
	// passes within the back-off: no mount, no write
	run(t, 'hosts_sync; r1=$?; hosts_sync; hosts_sync; echo "$r1"', `${FAKE_MOUNT}\nhostsfailat=$(date +%s)`);
	assert.equal(mountsLog(t).length, 1);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS_TABLE).mtimeMs, PAST.getTime());
	// after it: mount tried again, but the table already holds those bytes and is not written
	run(t, 'hosts_sync; true', `${FAKE_MOUNT}\nhostsfailat=$(( $(date +%s) - 1801 ))`);
	assert.equal(mountsLog(t).length, 2);
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS_TABLE).mtimeMs, PAST.getTime());
	// in one watcher, a bind that keeps failing is logged once
	const u = setup();
	chmodSync(u.env.HOMEHOOK_HOSTS, 0o444);
	writeFileSync(join(u.d, 'mount-fails'), '');
	run(u, 'hosts_sync; hostsfailat=1; hosts_sync; true', FAKE_MOUNT);
	assert.equal(mountsLog(u).length, 2);
	assert.equal(logOf(u).match(/could not bind/g).length, 1);
});

/** the watcher's own bind of the table over hosts, as the kernel shows it: /proc/mounts names the table's device, and through the bind
 * hosts is the table itself (a hard link gives the same device and inode) */
function ownBind (t) {
	writeFileSync(t.env.HOMEHOOK_HOSTS_TABLE, readFileSync(t.env.HOMEHOOK_HOSTS));
	rmSync(t.env.HOMEHOOK_HOSTS);
	linkSync(t.env.HOMEHOOK_HOSTS_TABLE, t.env.HOMEHOOK_HOSTS);
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/mmcblk0p20 ${t.env.HOMEHOOK_HOSTS} ext4 rw 0 0\n`);
	writeFileSync(join(t.d, 'hosts-bound'), '');
}

test('no-lg-block with the watcher\'s own bind: it is taken off once (umount), and not again', () => {
	const t = setup();
	ownBind(t);
	writeFileSync(join(t.d, 'hosts-bound'), '');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync; hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(t), [`umount ${t.env.HOMEHOOK_HOSTS}`]);
	assert.ok(!existsSync(join(t.d, 'hosts-bound')));
	assert.match(logOf(t), /taken off/);
	// with hosts-extra lines still wanted the bind stays, and only the LG lines go
	const u = setup();
	ownBind(u);
	writeFileSync(join(u.d, 'hosts-extra'), '0.0.0.0 ads.example.com\n');
	run(u, 'hosts_sync', FAKE_MOUNT);
	writeFileSync(u.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(u, 'hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(u), []);
	assert.equal(hostsOf(u), `127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ads.example.com\n${END}\n`);
});

/**
 * fake iptables and ip6tables, as xtables answers: -C exits 0 only when that exact rule is in the chain (1 and "Bad rule" otherwise), -I adds
 * it at the top, -D removes one copy (1 when there is none). With nomod, the kernel has no filter table: every call exits 3. With hang, every
 * call sleeps (a held xtables lock). Every call is logged.
 */
function fakeIptables (t, tools = ['iptables', 'ip6tables'], {nomod = [], hang = [], hangCheck = [], failInsert = []} = {}) {
	const sbin = join(t.d, 'sbin');
	mkdirSync(sbin, {recursive: true});
	for (const n of tools) {
		writeFileSync(join(sbin, n), `#!/bin/sh
echo "${n} $*" >> '${t.d}/calls'
${hang.includes(n) ? 'exec sleep 10' : ''}
${hangCheck.includes(n) ? '[ "$1" = -C ] && exec sleep 10' : ''}
${failInsert.includes(n) ? '[ "$1" = -I ] && exit 4' : ''}
${nomod.includes(n) ? `echo "${n} v1.6.1: can't initialize ${n} table \\\`filter': Table does not exist (do you need to insmod?)" >&2; exit 3` : ''}
r='${t.d}/rules-${n}'; touch "$r"
op=$1; shift; rule="$*"
case "$op" in
  -C) grep -qxF -- "$rule" "$r" && exit 0; echo "${n}: Bad rule (does a matching rule exist in that chain?)." >&2; exit 1 ;;
  -I) { echo "$rule"; cat "$r"; } > "$r.n" && mv "$r.n" "$r" ;;
  -D) grep -qxF -- "$rule" "$r" || { echo "${n}: Bad rule (does a matching rule exist in that chain?)." >&2; exit 1; }
      awk -v x="$rule" '$0 == x && !d { d = 1; next } { print }' "$r" > "$r.n" && mv "$r.n" "$r" ;;
  *) exit 2 ;;
esac
`, {mode: 0o755});
	}
	return () => (existsSync(join(t.d, 'calls')) ? readFileSync(join(t.d, 'calls'), 'utf8').trim().split('\n') : []);
}
const rules = (t, n) => (existsSync(join(t.d, `rules-${n}`)) ? readFileSync(join(t.d, `rules-${n}`), 'utf8').trim().split('\n').filter(Boolean) : []);
const RULE = 'INPUT -p tcp --dport 9998 ! -i lo -j DROP';

test('debugger_guard drops 9998 on every interface but loopback, IPv4 and IPv6, once: a second pass only checks', () => {
	const t = setup();
	const calls = fakeIptables(t);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard');
	assert.deepEqual(calls(), [`iptables -C ${RULE}`, `iptables -I ${RULE}`, `ip6tables -C ${RULE}`, `ip6tables -I ${RULE}`]);
	run(t, 'debugger_guard; debugger_guard');
	assert.deepEqual(calls().slice(4), [`iptables -C ${RULE}`, `ip6tables -C ${RULE}`, `iptables -C ${RULE}`, `ip6tables -C ${RULE}`]);
	assert.deepEqual(rules(t, 'iptables'), [RULE]);
	assert.deepEqual(rules(t, 'ip6tables'), [RULE]);
	assert.match(logOf(t), /debugger: port 9998 closed$/m);
	for (const c of calls()) assert.match(c, /--dport 9998 ! -i lo -j DROP$/);
});

test('Developer Mode\'s flag as a folder (this TV, webOS 4.4.3) counts as on', () => {
	const t = setup();
	fakeIptables(t);
	mkdirSync(t.env.HOMEHOOK_DEVMODE_FLAG);
	run(t, 'debugger_guard');
	assert.deepEqual(rules(t, 'iptables'), [RULE]);
	assert.match(logOf(t), /port 9998 closed/);
});

test('IPv6 with no ip6_tables in the kernel: "partial" in the log, and that family is not tried again', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables', 'ip6tables'], {nomod: ['ip6tables']});
	execFileSync('rm', [join(t.d, 'net', 'ip6_tables_names')]);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard; debugger_guard; debugger_guard');
	assert.deepEqual(calls().filter((c) => c.startsWith('ip6tables')), [`ip6tables -C ${RULE}`]);   // on the first pass only, and no -I
	assert.deepEqual(rules(t, 'iptables'), [RULE]);
	const log = logOf(t).trim().split('\n');
	assert.equal(log.length, 1);
	assert.match(log[0], /port 9998 partial \(closed on IPv4, still OPEN on IPv6, no firewall for IPv6\)/);
	assert.doesNotMatch(log[0], /port 9998 closed/);
});

test('no filter table at all: "nofirewall" once, and no iptables call every 30 s after it', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables', 'ip6tables'], {nomod: ['iptables', 'ip6tables']});
	execFileSync('rm', [join(t.d, 'net', 'ip_tables_names'), join(t.d, 'net', 'ip6_tables_names')]);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard; debugger_guard; debugger_guard');
	assert.deepEqual(calls(), [`iptables -C ${RULE}`, `ip6tables -C ${RULE}`]);
	assert.equal(logOf(t).trim().split('\n').length, 1);
	assert.match(logOf(t), /port 9998 nofirewall .*OPEN/);
	// no iptables binary at all: nothing run, the same state
	const none = setup();
	writeFileSync(none.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(none, 'debugger_guard; debugger_guard');
	assert.equal(logOf(none).trim().split('\n').length, 1);
	assert.match(logOf(none), /port 9998 nofirewall/);
});

test('a call that fails with the filter table there is tried again next pass; a hung iptables is cut off by the time limit', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables', 'ip6tables'], {failInsert: ['iptables']});   // -I fails, but ip_tables_names is there
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard; debugger_guard');
	assert.equal(calls().filter((c) => c.startsWith('iptables')).length, 4);
	assert.match(logOf(t), /port 9998 partial \(closed on IPv6, still OPEN on IPv4\)$/m);
	// -C itself fails (exit 3) with the table there: not known, so nothing is added, and it is asked again next pass
	const k = setup();
	const kcalls = fakeIptables(k, ['iptables', 'ip6tables'], {nomod: ['iptables']});
	writeFileSync(k.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(k, 'debugger_guard; debugger_guard');
	assert.deepEqual(kcalls().filter((c) => c.startsWith('iptables')), [`iptables -C ${RULE}`, `iptables -C ${RULE}`]);
	assert.match(logOf(k), /port 9998 partial \(closed on IPv6, not known on IPv4: iptables did not answer\)$/m);
	const h = setup();
	fakeIptables(h, ['iptables'], {hang: ['iptables']});
	writeFileSync(h.env.HOMEHOOK_DEVMODE_FLAG, '');
	const t0 = Date.now();
	run(h, 'debugger_guard');
	assert.ok(Date.now() - t0 < 6000, `took ${Date.now() - t0} ms`);
});

test('debugger-open takes the rule out; without Developer Mode nothing is run', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables']);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard');
	writeFileSync(t.env.HOMEHOOK_DEBUGGER_FLAG, '');
	run(t, 'debugger_guard');
	assert.deepEqual(calls().slice(2), [`iptables -C ${RULE}`, `iptables -D ${RULE}`, `iptables -C ${RULE}`]);
	assert.deepEqual(rules(t, 'iptables'), []);
	assert.match(logOf(t), /port 9998 open$/m);
	const off = setup();
	const offCalls = fakeIptables(off);
	run(off, 'debugger_guard');
	assert.deepEqual(offCalls(), []);
	assert.match(logOf(off), /port 9998 off/);
});

test('stop_watch.sh, run for real, drops the 9998 rule and the watcher\'s hosts block, and leaves the rest', () => {
	const t = setup('127.0.0.1 localhost\n127.0.0.1 snu.lge.com\n');
	fakeIptables(t);
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	writeFileSync(join(t.d, 'hosts-extra'), '0.0.0.0 ads.example.com\n');
	run(t, 'debugger_guard; hosts_sync');
	assert.deepEqual(rules(t, 'iptables'), [RULE]);
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	// someone else's rule in the chain stays
	writeFileSync(join(t.d, 'rules-iptables'), `${RULE}\nINPUT -p tcp --dport 22 -j ACCEPT\n`);
	const out = execFileSync('sh', [STOP], {encoding: 'utf8',
		env: {...process.env, ...t.env, HOMEHOOK_WATCH_SH: SCRIPT, HOMEHOOK_KEYBINDS: join(t.d, 'no-keybinds.json')}});
	assert.match(out, /port 9998 rule removed \(.*\/iptables\)/);
	assert.match(out, /port 9998 rule removed \(.*\/ip6tables\)/);
	assert.deepEqual(rules(t, 'iptables'), ['INPUT -p tcp --dport 22 -j ACCEPT']);
	assert.deepEqual(rules(t, 'ip6tables'), []);
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n127.0.0.1 snu.lge.com\n');
	// nothing is written, so the TV's country is not asked for (the one call is the watcher pass above)
	assert.equal(readFileSync(join(t.d, 'luna.log'), 'utf8').trim().split('\n').length, 1);
});

test('the main loop runs both on its first pass and about every 30 s', () => {
	const src = readFileSync(SCRIPT, 'utf8');
	const loop = src.slice(src.indexOf('while true; do\n  # wake'));
	assert.match(loop, /\[ \$\(\(ticks % 30\)\) -eq 1 \] && \{ owned hosts_sync; owned debugger_guard; \}/);
});

// ---- second review: iptables -C that does not answer, the hosts write, whose mount it is, loose lines ----------------------------------

test('a -C that times out while the rule is already there adds no second copy and is never logged "closed"', () => {
	const t = setup();
	const calls = fakeIptables(t, ['iptables'], {hangCheck: ['iptables']});
	writeFileSync(join(t.d, 'rules-iptables'), `${RULE}\n`);
	writeFileSync(join(t.d, 'net', 'ip6_tables_names'), 'filter\n');
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard; debugger_guard');
	assert.deepEqual(calls(), [`iptables -C ${RULE}`, `iptables -C ${RULE}`]);
	assert.deepEqual(rules(t, 'iptables'), [RULE]);
	assert.doesNotMatch(logOf(t), /closed/);
	assert.match(logOf(t), /port 9998 failed \(still OPEN on IPv6, not known on IPv4; tried again in 30 s\)$/m);
	// both families silent: "unknown", not "failed" or "closed"
	const u = setup();
	fakeIptables(u, ['iptables', 'ip6tables'], {hangCheck: ['iptables', 'ip6tables']});
	writeFileSync(u.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(u, 'debugger_guard');
	assert.match(logOf(u), /port 9998 unknown \(iptables did not answer on IPv4 IPv6; tried again in 30 s\)$/m);
	assert.deepEqual(rules(u, 'iptables'), []);
	// debugger-open with a silent -C: nothing deleted blind, and not called open and clean
	const o = setup();
	const ocalls = fakeIptables(o, ['iptables'], {hangCheck: ['iptables']});
	writeFileSync(join(o.d, 'rules-iptables'), `${RULE}\n`);
	writeFileSync(o.env.HOMEHOOK_DEBUGGER_FLAG, '');
	run(o, 'debugger_guard');
	assert.deepEqual(ocalls(), [`iptables -C ${RULE}`]);
	assert.match(logOf(o), /port 9998 open, but .*iptables did not answer: the rule may still be in it$/m);
});

test('debugger-open and stop_watch.sh take out every stacked copy of the rule; stop_watch.sh never says "removed" for a silent -C', () => {
	const t = setup();
	fakeIptables(t, ['iptables']);
	writeFileSync(join(t.d, 'rules-iptables'), `${RULE}\n${RULE}\nINPUT -p tcp --dport 22 -j ACCEPT\n${RULE}\n`);
	writeFileSync(t.env.HOMEHOOK_DEBUGGER_FLAG, '');
	run(t, 'debugger_guard');
	assert.deepEqual(rules(t, 'iptables'), ['INPUT -p tcp --dport 22 -j ACCEPT']);
	assert.match(logOf(t), /port 9998 open$/m);
	const stop = (u) => execFileSync('sh', [STOP], {encoding: 'utf8',
		env: {...process.env, ...u.env, HOMEHOOK_WATCH_SH: SCRIPT, HOMEHOOK_KEYBINDS: join(u.d, 'no-keybinds.json')}});
	const s = setup();
	fakeIptables(s, ['iptables']);
	writeFileSync(join(s.d, 'rules-iptables'), `${RULE}\n${RULE}\n${RULE}\n`);
	assert.match(stop(s), /port 9998 rule removed \(.*\/iptables\)/);
	assert.deepEqual(rules(s, 'iptables'), []);
	const h = setup();
	fakeIptables(h, ['iptables'], {hangCheck: ['iptables']});
	writeFileSync(join(h.d, 'rules-iptables'), `${RULE}\n`);
	const out = stop(h);
	assert.doesNotMatch(out, /removed \(/);
	assert.match(out, /iptables did not answer, it may still be there/);
	assert.deepEqual(rules(h, 'iptables'), [RULE]);
});

test('hosts_write: a first copy in hosts.bak before the rewrite, the file as written after it, sync after a real change only, and a build without its localhost line is not written', () => {
	const pre = '127.0.0.1 localhost\n::1 localhost ip6-localhost\n';
	const t = setup(pre);
	const SYNC = '';
	writeFileSync(join(t.d, 'bin', 'sync'), `#!/bin/sh\necho sync >> '${t.d}/sync.log'\n`, {mode: 0o755});
	run(t, 'hosts_sync', SYNC);
	assert.equal(readFileSync(join(t.d, 'hosts.bak'), 'utf8'), hostsOf(t));
	// the first copy, the "writing" mark, the write (with the new copy): each synced, and nothing left over
	assert.equal(readFileSync(join(t.d, 'sync.log'), 'utf8'), 'sync\nsync\nsync\n');
	for (const f of ['hosts.bak.part', 'hosts.writing', 'hosts.bak.new']) assert.ok(!existsSync(join(t.d, f)), f);
	run(t, 'hosts_sync', SYNC);
	assert.equal(readFileSync(join(t.d, 'sync.log'), 'utf8'), 'sync\nsync\nsync\n');
	// a build that lost localhost (or one of its localhost lines): never written at all
	for (const build of ["printf '0.0.0.0 ad.lgsmartad.com\\n'", "printf '127.0.0.1 localhost\\n0.0.0.0 ad.lgsmartad.com\\n'"]) {
		const b = setup(pre);
		utimesSync(b.env.HOMEHOOK_HOSTS, PAST, PAST);
		assert.equal(run(b, 'hosts_sync; echo "rc=$?"', `${SYNC}\nhosts_build () { ${build} > "$1"; }`), 'rc=1');
		assert.equal(hostsOf(b), pre);
		assert.equal(statSync(b.env.HOMEHOOK_HOSTS).mtimeMs, PAST.getTime());
		assert.match(logOf(b), /would lose a localhost line: not written/);
		assert.doesNotMatch(logOf(b), /rebuilt in place/);
	}
	// a short write (a full disk): put back too
	const c = setup(pre);
	run(c, 'hosts_sync; true', `cat () { if [ "$1" = "$HOMEHOOK_RUN/hosts.new" ]; then command head -c 12 "$1"; return 1; fi; command cat "$@"; }`);
	assert.equal(hostsOf(c), pre);
	assert.match(logOf(c), /put back as it was/);
});

// a live writer holding the mkdir lock: a process whose command line is a watch.sh, as a watcher's is
const LEGIT_HOLDER = `printf 'sleep 3\\n' > "$HOMEHOOK_RUN/watch.sh"; sh "$HOMEHOOK_RUN/watch.sh" >/dev/null 2>&1 &
mkdir -m 700 "$HOMEHOOK_RUN/hosts.lock"; echo $! > "$HOMEHOOK_RUN/hosts.lock/pid"; sleep 0.2`;
for (const [kind, flock] of [['mkdir', ''], ['flock', null]]) {
	test(`hosts_sync waits for the hosts lock (${kind}) and skips the pass when it stays held; a lock whose holder is gone is taken over`, () => {
		const env = flock === null ? {} : {HOMEHOOK_FLOCK: flock};
		const t = setup();
		Object.assign(t.env, env, {HOMEHOOK_HOSTS_LOCK_SECS: '1'});
		// another holder, alive for the whole pass
		const hold = flock === null
			? `flock -n "$HOMEHOOK_RUN/hosts.lock.f" sleep 3 >/dev/null 2>&1 & sleep 0.3`
			: `${LEGIT_HOLDER}`;
		assert.equal(run(t, `hosts_sync; echo "rc=$?"`, hold), 'rc=1');
		assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
		assert.match(logOf(t), /being written by another .* skipped/);
		if (flock === null) return;
		// a mkdir lock left by a pid that is gone: taken over, and let go after
		const s = setup();
		Object.assign(s.env, env, {HOMEHOOK_HOSTS_LOCK_SECS: '1'});
		mkdirSync(join(s.d, 'hosts.lock'));
		writeFileSync(join(s.d, 'hosts.lock', 'pid'), `${2 ** 22 + 7}\n`);
		run(s, 'hosts_sync');
		assert.match(hostsOf(s), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
		assert.ok(!existsSync(join(s.d, 'hosts.lock')));
	});
}

/** the real watch.sh, sourced, running one hosts_sync whose write of the block into hosts stops half way for a second (touching inwrite
 * there), then idling. With proc, it also shows up there with a watcher's command line, for stop_watch.sh. */
function slowWriter (t, proc = '') {
	const reg = proc ? `mkdir -p "${proc}/$$"; printf '/bin/sh\\0/var/lib/homehook/watch.sh\\0' > "${proc}/$$/cmdline"` : ':';
	return spawn('sh', ['-c', `WATCH_SH_LIB=1 . '${SCRIPT}'
		EXTRA='${join(t.d, 'hosts-extra')}'
		${reg}
		cat () { if [ "$1" = "$RUN/hosts.new" ]; then command head -c 30 "$1"; : > "${t.d}/inwrite"; sleep 1; command tail -c +31 "$1"; else command cat "$@"; fi; }
		hosts_sync; : > "${t.d}/synced"
		while :; do sleep 0.1; done`], {stdio: 'ignore', env: {...process.env, ...t.env}});
}

test('stop_watch.sh waits until the watcher has ended (its last hosts write done) before it takes the block out', async () => {
	const t = setup();
	const proc = join(t.d, 'proc');
	// a "watcher" with no TERM trap of its own: the real watch.sh, sourced, in a pass whose write of the block is slow (a cat that stops
	// half way for a second); it is stopped in the middle of that write
	const child = slowWriter(t, proc);
	const exited = new Promise((r) => child.on('exit', r));
	while (!existsSync(join(t.d, 'inwrite'))) await new Promise((r) => setTimeout(r, 20));
	const out = await new Promise((resolve, reject) => {
		const s = spawn('sh', [STOP], {env: {...process.env, ...t.env, HOMEHOOK_PROC: proc, HOMEHOOK_WATCH_SH: SCRIPT,
			HOMEHOOK_KEYBINDS: join(t.d, 'no-keybinds.json')}});
		let o = '';
		s.stdout.on('data', (b) => { o += b; });
		s.on('exit', (code) => (code === 0 ? resolve(o) : reject(new Error(`exit ${code}`))));
	});
	await exited;
	assert.match(out, /LG hosts block removed/);
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
	// the watcher's write was whole when it ended: nothing had to be put back
	assert.doesNotMatch(logOf(t), /put back/);
});

test('the watcher\'s own bind (hosts is the table): umount, and the mark goes only once it is off; a failed umount empties it and says so', () => {
	const t = setup();
	ownBind(t);
	writeFileSync(join(t.d, 'umount-fails'), '');
	run(t, 'hosts_sync', FAKE_MOUNT);   // with something wanted: no umount tried
	assert.deepEqual(mountsLog(t), []);
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(t), [`umount ${t.env.HOMEHOOK_HOSTS}`]);
	assert.ok(existsSync(join(t.d, 'hosts-bound')), 'the mark stays while the bind is still on');
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
	assert.match(logOf(t), /could not take .* off .*, emptied it in place instead$/m);
	// next pass: the umount is tried again, and works
	execFileSync('rm', [join(t.d, 'umount-fails')]);
	run(t, 'hosts_sync', FAKE_MOUNT);
	assert.equal(mountsLog(t).length, 2);
	assert.ok(!existsSync(join(t.d, 'hosts-bound')));
	assert.match(logOf(t), /taken off/);
});

test('a failed umount over a read-only bind is not reported as emptied', roSkip, () => {
	const t = setup();
	ownBind(t);
	run(t, 'hosts_sync', FAKE_MOUNT);
	chmodSync(t.env.HOMEHOOK_HOSTS, 0o444);
	writeFileSync(join(t.d, 'umount-fails'), '');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', FAKE_MOUNT), 'rc=1');
	assert.doesNotMatch(logOf(t), /empt/);
	assert.match(logOf(t), /could not take .* off .*, nor rewrite it \(read-only\)/);
	assert.ok(existsSync(join(t.d, 'hosts-bound')));
});

test('someone else\'s mount on hosts (a tmpfs) is never taken off, even with our mark: the mark goes and the file is rebuilt in place', () => {
	const t = setup();
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/root / squashfs ro 0 0\ntmpfs ${t.env.HOMEHOOK_HOSTS} tmpfs rw,relatime 0 0\n`);
	writeFileSync(t.env.HOMEHOOK_HOSTS_TABLE, '127.0.0.1 localhost\n');
	run(t, 'hosts_sync', FAKE_MOUNT);
	writeFileSync(join(t.d, 'hosts-bound'), '');   // a mark left from a bind of ours that someone else's mount replaced
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync; hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(t), []);
	assert.ok(!existsSync(join(t.d, 'hosts-bound')));
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
	assert.match(logOf(t), /not this watcher's bind .* left as it is/);
	assert.doesNotMatch(logOf(t), /empt|taken off/);
	// a mark with nothing mounted at all: just dropped
	const u = setup();
	writeFileSync(join(u.d, 'hosts-bound'), '');
	writeFileSync(u.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(u, 'hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(u), []);
	assert.ok(!existsSync(join(u.d, 'hosts-bound')));
});

test('hosts_bound: a mount whose path differs only where a regex "." would match does not count', () => {
	const t = setup();
	mkdirSync(join(t.d, 'a.b'));
	t.env.HOMEHOOK_HOSTS = join(t.d, 'a.b', 'hosts');
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `tmpfs ${join(t.d, 'aXb', 'hosts')} tmpfs rw 0 0\n`);
	assert.equal(run(t, 'hosts_bound && echo yes || echo no'), 'no');
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `tmpfs ${join(t.d, 'a.b', 'hosts')} tmpfs rw 0 0\n`);
	assert.equal(run(t, 'hosts_bound && echo yes || echo no'), 'yes');
});

test('a 0.0.0.0 line added by hand outside the block is left alone, even for a name on the list (the firmware servers, no update flag)', () => {
	const pre = '127.0.0.1 localhost\n0.0.0.0 su.lge.com\n:: snu.lge.com\n';
	const t = setup(pre);
	run(t, 'hosts_sync');
	assert.ok(hostsOf(t).startsWith(`${pre}${BEGIN}\n`));
	assert.equal(resolve(hostsOf(t), 'su.lge.com'), '0.0.0.0');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync');
	assert.equal(hostsOf(t), pre);
	// only lines this watcher last wrote count as ours outside a block, and only once its markers are gone
	const u = setup();
	run(u, 'hosts_sync');
	const lines = hostsOf(u).split('\n').filter((l) => l !== BEGIN && l !== END);
	writeFileSync(u.env.HOMEHOOK_HOSTS, `${lines.join('\n')}0.0.0.0 mine.example\n`);
	writeFileSync(u.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(u, 'hosts_sync');
	assert.equal(hostsOf(u), '127.0.0.1 localhost\n0.0.0.0 mine.example\n');
});

// ---- third review: a stop in the middle of the write, and the mkdir lock ---------------------------------------------------------------

const waitFor = async (f) => { while (!existsSync(f)) await new Promise((r) => setTimeout(r, 20)); };

test('TERM in the middle of the real hosts write: the write is finished first, then the watcher exits (no half-written hosts)', async () => {
	const t = setup();
	const child = slowWriter(t);
	const exited = new Promise((r) => child.on('exit', (code, sig) => r({code, sig})));
	await waitFor(join(t.d, 'inwrite'));
	child.kill('SIGTERM');
	const {code, sig} = await exited;
	assert.equal(sig, null);
	assert.equal(code, 143);
	const h = hostsOf(t);
	assert.ok(h.startsWith(`127.0.0.1 localhost\n${BEGIN}\n`));
	assert.ok(h.endsWith(`${END}\n`));
	assert.equal(readFileSync(join(t.d, 'hosts.bak'), 'utf8'), h);
	assert.ok(!existsSync(join(t.d, 'hosts.bak.new')));
	assert.ok(!existsSync(join(t.d, 'hosts.writing')));
	assert.ok(!existsSync(join(t.d, 'synced')), 'it exits right after the write, not at the end of its pass');
});

test('KILL in the middle of the real hosts write: the next pass puts the old file back before it builds on it', async () => {
	const t = setup();
	const child = slowWriter(t);
	const exited = new Promise((r) => child.on('exit', r));
	await waitFor(join(t.d, 'inwrite'));
	child.kill('SIGKILL');
	await exited;
	assert.ok(!hostsOf(t).endsWith(`${END}\n`), 'cut short');
	assert.ok(existsSync(join(t.d, 'hosts.writing')));
	run(t, 'hosts_sync');
	const h = hostsOf(t);
	assert.ok(h.startsWith(`127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ad.lgsmartad.com\n`));
	assert.equal(h.split('\n').filter((l) => l === BEGIN).length, 1);
	assert.match(logOf(t), /was left half written: put back from hosts\.bak$/m);
	assert.ok(!existsSync(join(t.d, 'hosts.writing')));
	assert.equal(readFileSync(join(t.d, 'hosts.bak'), 'utf8'), h);
	// and stop_watch.sh after such a kill: the file is put back and the block taken out, not left empty
	const u = setup('127.0.0.1 localhost\n::1 localhost\n');
	run(u, 'hosts_sync');
	writeFileSync(u.env.HOMEHOOK_HOSTS, '');
	execFileSync('sh', [STOP], {encoding: 'utf8', env: {...process.env, ...u.env, HOMEHOOK_WATCH_SH: SCRIPT, HOMEHOOK_KEYBINDS: join(u.d, 'none.json')}});
	assert.equal(hostsOf(u), '127.0.0.1 localhost\n::1 localhost\n');
});

test('a hosts file found emptied is put back from hosts.bak, and the empty file never replaces the good copy', () => {
	const pre = '127.0.0.1 localhost\n::1 localhost ip6-localhost\n';
	const t = setup(pre);
	run(t, 'hosts_sync');
	const good = hostsOf(t);
	writeFileSync(t.env.HOMEHOOK_HOSTS, '');
	run(t, 'hosts_sync; hosts_sync');
	assert.equal(hostsOf(t), good);
	assert.equal(readFileSync(join(t.d, 'hosts.bak'), 'utf8'), good);
	assert.match(logOf(t), /put back from hosts\.bak$/m);
});

const MK = {HOMEHOOK_FLOCK: '', HOMEHOOK_HOSTS_LOCK_SECS: '1'};

test('the mkdir lock: made mode 700, and a live watcher holding it past 60 s is waited for, not taken over', () => {
	const t = setup();
	Object.assign(t.env, MK);
	assert.equal(run(t, 'hosts_lock && stat -c %a "$HOSTS_LOCK"; hosts_unlock; [ -e "$HOSTS_LOCK" ] || echo gone'), '700\ngone');
	const out = run(t, 'hosts_sync; echo "rc=$?"; cat "$HOSTS_LOCK/pid"',
		`${LEGIT_HOLDER}\ntouch -t 202001010000 "$HOMEHOOK_RUN/hosts.lock"\nholder=$(cat "$HOMEHOOK_RUN/hosts.lock/pid")`).split('\n');
	assert.equal(out[0], 'rc=1');
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
	assert.ok(existsSync(join(t.d, 'hosts.lock', 'pid')));
});

test('the mkdir lock: a pid reused by an unrelated process is taken over (moved aside, then cleared, never rm -r)', () => {
	const t = setup();
	Object.assign(t.env, MK);
	// not a forked shell (busybox ash runs sleep in a fork that keeps this command line, which names watch.sh): another program
	run(t, 'hosts_sync', `'${process.execPath}' -e 'setTimeout(() => {}, 3000)' >/dev/null 2>&1 &\nmkdir -m 700 "$HOMEHOOK_RUN/hosts.lock"; echo $! > "$HOMEHOOK_RUN/hosts.lock/pid"`);
	assert.match(hostsOf(t), /^0\.0\.0\.0 ad\.lgsmartad\.com$/m);
	assert.ok(!existsSync(join(t.d, 'hosts.lock')));
	assert.equal(execFileSync('sh', ['-c', `ls -a '${t.d}' | grep -c 'hosts.lock.old' || true`], {encoding: 'utf8'}).trim(), '0');
});

test('the mkdir lock: unlock leaves a lock another process holds now', () => {
	const t = setup();
	Object.assign(t.env, MK);
	assert.equal(run(t, 'mkdir -m 700 "$HOSTS_LOCK"; echo 1 > "$HOSTS_LOCK/pid"; hosts_unlock; cat "$HOSTS_LOCK/pid"'), '1');
});

test('the mkdir lock: a clock step forward does not make a live holder\'s lock look stale', () => {
	const t = setup();
	Object.assign(t.env, MK, {HOMEHOOK_HOSTS_LOCK_SECS: '2'});
	const real = execFileSync('sh', ['-c', 'command -v date'], {encoding: 'utf8'}).trim();
	writeFileSync(join(t.d, 'bin', 'date'), `#!/bin/sh\nif [ "$1" = +%s ]; then echo $(( $(${real} +%s) + 100000 )); else exec ${real} "$@"; fi\n`, {mode: 0o755});
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"', LEGIT_HOLDER), 'rc=1');
	assert.equal(hostsOf(t), '127.0.0.1 localhost\n');
	assert.ok(existsSync(join(t.d, 'hosts.lock', 'pid')));
});

// ---- fourth review: the known-good copy, and what recovery trusts --------------------------------------------

const GOOD = '127.0.0.1 localhost\n::1 localhost\n10.0.0.8 nas.home\n';
const bakOf = (t) => readFileSync(join(t.d, 'hosts.bak'), 'utf8');
/** hosts as a pass leaves it: every line it had, then the block */
const keptAll = (t, pre) => { const h = hostsOf(t); assert.ok(h.startsWith(`${pre}${BEGIN}\n0.0.0.0 ad.lgsmartad.com\n`), h); };

test('hosts.bak is only ever the file a write left whole: a torn hosts is never copied in; an older build\'s hosts.bak.new is put back or dropped', () => {
	// ecf96ed's write cut short with its localhost line left: hosts.bak.new (its pre-image) is put back, and that pass copies nothing
	const torn = `127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ad.lgs`;
	const t = setup(torn);
	writeFileSync(join(t.d, 'hosts.bak'), GOOD);
	writeFileSync(join(t.d, 'hosts.bak.new'), GOOD);
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"'), 'rc=1');
	assert.equal(hostsOf(t), GOOD);
	assert.equal(bakOf(t), GOOD);
	assert.ok(!existsSync(join(t.d, 'hosts.bak.new')));
	assert.match(logOf(t), /put back from hosts\.bak\.new/);
	run(t, 'hosts_sync');
	keptAll(t, GOOD);
	assert.equal(bakOf(t), hostsOf(t));
	// one with no localhost line is dropped; and a pass that writes nothing, or whose sync after the write fails, leaves hosts.bak as it is
	const u = setup(GOOD);
	writeFileSync(join(u.d, 'hosts.bak'), GOOD);
	writeFileSync(join(u.d, 'hosts.bak.new'), '');
	run(u, 'hosts_sync');
	keptAll(u, GOOD);
	assert.ok(!existsSync(join(u.d, 'hosts.bak.new')));
	const written = hostsOf(u);
	writeFileSync(u.env.HOMEHOOK_HOSTS, written.replace(BEGIN, `10.0.0.9 by.hand\n${BEGIN}`));
	run(u, 'hosts_sync');
	assert.equal(bakOf(u), written);
	writeFileSync(join(u.d, 'hosts-extra'), '0.0.0.0 one.example\n');
	writeFileSync(join(u.d, 'bin', 'sync'), `#!/bin/sh\n[ -f '${u.d}/hosts.writing' ] && grep -q one.example '${u.d}/hosts' && exit 1\nexit 0\n`, {mode: 0o755});
	run(u, 'hosts_sync');
	assert.match(hostsOf(u), /^0\.0\.0\.0 one\.example$/m);
	assert.equal(bakOf(u), written);
	assert.ok(!existsSync(join(u.d, 'hosts.bak.part')));
});

test('hosts.bak and the writing mark are on flash, not in RUN (tmpfs): after a power cut in the write, the cut-short hosts is put back; the mark goes only once the sync after the write returned 0', () => {
	const t = setup(GOOD);
	const bare = {...t.env};
	delete bare.HOMEHOOK_HOSTS_BAK; delete bare.HOMEHOOK_HOSTS_WRITING;
	assert.equal(run({d: t.d, env: bare}, 'echo "$HOSTS_BAK $HOSTS_WRITING"'), '/var/lib/homehook/hosts.bak /var/lib/homehook/hosts.writing');
	const flash = join(t.d, 'flash'), runDir = join(t.d, 'run');
	mkdirSync(flash); mkdirSync(runDir);
	Object.assign(t.env, {HOMEHOOK_RUN: runDir, HOMEHOOK_HOSTS_BAK: join(flash, 'hosts.bak'), HOMEHOOK_HOSTS_WRITING: join(flash, 'hosts.writing')});
	run(t, 'hosts_sync');
	const written = hostsOf(t);
	assert.equal(readFileSync(join(flash, 'hosts.bak'), 'utf8'), written);
	// the sync after the next write fails: the write stands, the mark stays and hosts.bak is not replaced
	writeFileSync(join(t.d, 'hosts-extra'), '0.0.0.0 one.example\n');
	writeFileSync(join(t.d, 'bin', 'sync'), `#!/bin/sh\n[ -f '${flash}/hosts.writing' ] && grep -q one.example '${t.d}/hosts' && exit 1\nexit 0\n`, {mode: 0o755});
	run(t, 'hosts_sync');
	assert.match(hostsOf(t), /^0\.0\.0\.0 one\.example$/m);
	assert.ok(existsSync(join(flash, 'hosts.writing')));
	assert.equal(readFileSync(join(flash, 'hosts.bak'), 'utf8'), written);
	// the power cut: RUN is gone, hosts was left cut short with its localhost line, hosts.bak and the mark are still there
	rmSync(runDir, {recursive: true}); mkdirSync(runDir);
	writeFileSync(join(t.d, 'bin', 'sync'), SYNC_BIN, {mode: 0o755});
	writeFileSync(t.env.HOMEHOOK_HOSTS, `127.0.0.1 localhost\n${BEGIN}\n0.0.0.0 ad.lgs`);
	run(t, 'hosts_sync');
	assert.match(logOf(t), /was left half written: put back from hosts\.bak$/m);
	keptAll(t, GOOD);
	assert.match(hostsOf(t), /^0\.0\.0\.0 one\.example$/m);
	assert.ok(!existsSync(join(flash, 'hosts.writing')));
	assert.equal(readFileSync(join(flash, 'hosts.bak'), 'utf8'), hostsOf(t));
});

test('KILL in the middle of the backup copy: hosts and the last good copy are both left whole, and the partial copy is never used', async () => {
	const t = setup(GOOD);
	writeFileSync(join(t.d, 'hosts.bak'), GOOD);
	writeFileSync(join(t.d, 'hosts-extra'), '0.0.0.0 one.example\n');
	run(t, 'hosts_sync');
	const before = hostsOf(t);
	writeFileSync(join(t.d, 'hosts-extra'), '0.0.0.0 one.example\n0.0.0.0 two.example\n');
	// the copy of hosts stops after its first line, and the watcher is killed there
	const child = spawn('sh', ['-c', `WATCH_SH_LIB=1 . '${SCRIPT}'
		EXTRA='${join(t.d, 'hosts-extra')}'
		cat () { if [ "$1" = "$HOSTS" ]; then command head -n 1 "$1"; : > "${t.d}/incopy"; sleep 5; fi; command cat "$@"; }
		hosts_sync`], {stdio: 'ignore', env: {...process.env, ...t.env}});
	const exited = new Promise((r) => child.on('exit', r));
	await waitFor(join(t.d, 'incopy'));
	child.kill('SIGKILL');
	await exited;
	// the copy is made after the write came out whole, before its sync: hosts is the new file, hosts.bak still the last one, the mark stays
	const after = hostsOf(t);
	assert.match(after, /^0\.0\.0\.0 two\.example$/m);
	assert.equal(bakOf(t), before);
	assert.ok(existsSync(join(t.d, 'hosts.writing')));
	run(t, 'hosts_sync');
	keptAll(t, GOOD);
	assert.equal(hostsOf(t), after);
	assert.equal(bakOf(t), after);
	assert.ok(!existsSync(join(t.d, 'hosts.bak.part')));
});

test('a failed or timed-out sync makes no good copy: hosts is not written, and hosts.bak is not replaced', () => {
	for (const code of [1, 143]) {
		const t = setup(GOOD);
		writeFileSync(join(t.d, 'hosts.bak'), '127.0.0.1 localhost\n');
		writeFileSync(join(t.d, 'bin', 'sync'), `#!/bin/sh\nexit ${code}\n`, {mode: 0o755});
		assert.equal(run(t, 'hosts_sync; echo "rc=$?"'), 'rc=1');
		assert.equal(hostsOf(t), GOOD);
		assert.equal(bakOf(t), '127.0.0.1 localhost\n');
		for (const f of ['hosts.bak.part', 'hosts.writing']) assert.ok(!existsSync(join(t.d, f)), f);
		assert.match(logOf(t), /could not make a good copy/);
	}
});

test('a hosts file with no localhost line at all is never rewritten, and "every localhost line kept" is never true of none', () => {
	const t = setup('10.0.0.8 nas.home\n');
	utimesSync(t.env.HOMEHOOK_HOSTS, PAST, PAST);
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"'), 'rc=1');
	assert.equal(hostsOf(t), '10.0.0.8 nas.home\n');
	assert.equal(statSync(t.env.HOMEHOOK_HOSTS).mtimeMs, PAST.getTime());
	assert.ok(!existsSync(join(t.d, 'hosts.bak')));
	writeFileSync(join(t.d, 'none'), '0.0.0.0 ad.lgsmartad.com\n# localhost\n');
	writeFileSync(join(t.d, 'empty'), '');
	assert.equal(run(t, `hosts_localhost_kept '${t.d}/empty' '${t.d}/none' && echo kept || echo no`), 'no');
	assert.equal(run(t, `hosts_localhost_kept '${t.d}/none' '${t.d}/none' && echo kept || echo no`), 'no');
	assert.equal(run(t, `hosts_localhost_kept '${t.d}/hosts.new.x' '${t.d}/none' && echo kept || echo no`), 'no');
});

test('a hand edit that changed a localhost line is kept: hosts.bak is put back only when hosts has no localhost line left', () => {
	const t = setup();
	writeFileSync(join(t.d, 'hosts.bak'), '127.0.0.1 localhost\n::1 localhost\n');
	const live = '127.0.0.1 localhost mytv\n10.0.0.8 nas.home\n::1 localhost\n';
	writeFileSync(t.env.HOMEHOOK_HOSTS, live);
	run(t, 'hosts_sync; hosts_sync');
	keptAll(t, live);
	assert.doesNotMatch(logOf(t), /put back/);
	// "localhost" only in a comment or as part of another name is not a localhost line: put back
	for (const gone of ['# 127.0.0.1 localhost\n10.0.0.8 nas.home\n', '127.0.0.1 localhost.example\n', '\n']) {
		const u = setup();
		writeFileSync(join(u.d, 'hosts.bak'), GOOD);
		writeFileSync(u.env.HOMEHOOK_HOSTS, gone);
		run(u, 'hosts_sync');
		keptAll(u, GOOD);
		assert.match(logOf(u), /has no localhost line: put back from hosts\.bak$/m);
	}
});

test('written wrong and not put back: the old file really is in hosts.bak, as the log says, and the next pass puts it back', () => {
	const t = setup(GOOD);
	// every write of the new file and of the copy back comes out short
	assert.equal(run(t, 'hosts_sync; echo "rc=$?"',
		'cat () { case "$1" in "$RUN/hosts.new"|"$HOSTS_BAK") command head -c 12 "$1"; return 1 ;; esac; command cat "$@"; }'), 'rc=1');
	assert.match(logOf(t), new RegExp(`could not be put back: the old file is in ${join(t.d, 'hosts.bak').replace(/[.]/g, '\\.')},`));
	assert.equal(bakOf(t), GOOD);
	assert.notEqual(hostsOf(t), GOOD);
	run(t, 'hosts_sync');
	keptAll(t, GOOD);
});
