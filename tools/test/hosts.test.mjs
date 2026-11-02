// node --test tools/test/*.test.mjs: the watcher's LG host blocking (hosts_sync) and the port 9998 rule (debugger_guard) in tools/tv/watch.sh,
// and their removal by tools/tv/stop_watch.sh. The script is sourced with WATCH_SH_LIB=1, which stops it before its loops; /etc/hosts,
// /proc/mounts, /proc/net, the flags, iptables and luna-send are files in a temp folder, and mount and umount are shell functions.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, utimesSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const SCRIPT = new URL('../../tools/tv/watch.sh', import.meta.url).pathname;
const STOP = new URL('../../tools/tv/stop_watch.sh', import.meta.url).pathname;
const BEGIN = '# >>> Lumen watcher (watch.sh hosts_sync): rebuilt about every 30 s, edits between these lines are lost';
const END = '# <<< Lumen watcher';
const FAKE_MOUNT = `mount () { echo "mount $*" >> "$HOMEHOOK_RUN/mounts.log"; [ ! -f "$HOMEHOOK_RUN/mount-fails" ]; }
umount () { echo "umount $*" >> "$HOMEHOOK_RUN/mounts.log"; }`;

function setup (hosts = '127.0.0.1 localhost\n') {
	const d = mkdtempSync(join(tmpdir(), 'hosts-'));
	writeFileSync(join(d, 'hosts'), hosts);
	writeFileSync(join(d, 'mounts'), '/dev/root / squashfs ro 0 0\n');
	mkdirSync(join(d, 'net'));
	writeFileSync(join(d, 'net', 'ip_tables_names'), 'filter\n');
	writeFileSync(join(d, 'net', 'ip6_tables_names'), 'filter\n');
	mkdirSync(join(d, 'bin'));
	// luna-send answers nothing unless a test gives it an answer
	writeFileSync(join(d, 'bin', 'luna-send'), `#!/bin/sh\necho "$*" >> '${d}/luna.log'\n[ -f '${d}/luna.answer' ] && cat '${d}/luna.answer'\nexit 0\n`, {mode: 0o755});
	const env = {HOMEHOOK_HOSTS: join(d, 'hosts'), HOMEHOOK_HOSTS_TABLE: join(d, 'table'), HOMEHOOK_MOUNTS: join(d, 'mounts'),
		HOMEHOOK_NOLGBLOCK_FLAG: join(d, 'no-lg-block'), HOMEHOOK_DEBUGGER_FLAG: join(d, 'debugger-open'),
		HOMEHOOK_DEVMODE_FLAG: join(d, 'devmode_enabled'), HOMEHOOK_IPT_DIRS: join(d, 'sbin'), HOMEHOOK_LOG: join(d, 'log'), HOMEHOOK_RUN: d,
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
	// bare lines an earlier build appended outside a block are this list's too, and go; a name the owner gave another address stays
	const old = setup('127.0.0.1 localhost\n0.0.0.0 ad.lgsmartad.com\n:: ad.lgsmartad.com\n0.0.0.0 su.lge.com\n192.0.2.9 smartad.lge.com\n');
	writeFileSync(old.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(old, 'hosts_sync');
	assert.equal(hostsOf(old), '127.0.0.1 localhost\n192.0.2.9 smartad.lge.com\n');
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

test('no-lg-block with the watcher\'s own bind: it is taken off once (umount), and not again', () => {
	const t = setup();
	writeFileSync(t.env.HOMEHOOK_MOUNTS, `/dev/mmcblk0p20 ${t.env.HOMEHOOK_HOSTS} ext4 rw 0 0\n`);
	writeFileSync(join(t.d, 'hosts-bound'), '');
	writeFileSync(t.env.HOMEHOOK_NOLGBLOCK_FLAG, '');
	run(t, 'hosts_sync; hosts_sync', FAKE_MOUNT);
	assert.deepEqual(mountsLog(t), [`umount ${t.env.HOMEHOOK_HOSTS}`]);
	assert.ok(!existsSync(join(t.d, 'hosts-bound')));
	assert.match(logOf(t), /taken off/);
	// with hosts-extra lines still wanted the bind stays, and only the LG lines go
	const u = setup();
	writeFileSync(u.env.HOMEHOOK_MOUNTS, `/dev/mmcblk0p20 ${u.env.HOMEHOOK_HOSTS} ext4 rw 0 0\n`);
	writeFileSync(join(u.d, 'hosts-bound'), '');
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
function fakeIptables (t, tools = ['iptables', 'ip6tables'], {nomod = [], hang = []} = {}) {
	const sbin = join(t.d, 'sbin');
	mkdirSync(sbin, {recursive: true});
	for (const n of tools) {
		writeFileSync(join(sbin, n), `#!/bin/sh
echo "${n} $*" >> '${t.d}/calls'
${hang.includes(n) ? 'exec sleep 10' : ''}
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
	assert.equal(calls().filter((c) => c.startsWith('ip6tables')).length, 2);   // -C and -I on the first pass only
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
	assert.equal(calls().length, 4);
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
	const calls = fakeIptables(t, ['iptables', 'ip6tables'], {nomod: ['iptables']});   // fails, but ip_tables_names is there
	writeFileSync(t.env.HOMEHOOK_DEVMODE_FLAG, '');
	run(t, 'debugger_guard; debugger_guard');
	assert.equal(calls().filter((c) => c.startsWith('iptables')).length, 4);
	assert.match(logOf(t), /port 9998 partial \(closed on IPv6, still OPEN on IPv4\)/);
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
	assert.deepEqual(calls().slice(2), [`iptables -C ${RULE}`, `iptables -D ${RULE}`]);
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
