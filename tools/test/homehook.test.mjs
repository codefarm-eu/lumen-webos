// node --test tools/test/*.test.mjs: the boot hook (tools/tv/60-homehook) that starts the watchers, also used by Lumen's watcher restart.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync, spawnSync} from 'node:child_process';
import {chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const HOOK = new URL('../../tools/tv/60-homehook', import.meta.url).pathname;
// the TV's sh is busybox ash; dash (Debian's sh) takes no fds over 9, so the descriptor test needs busybox
const ASH = spawnSync('busybox', ['ash', '-c', 'true']).status === 0;

test('the watchers start without the descriptors of whoever ran the hook (the Homebrew Channel hub socket)', {skip: !ASH && 'needs busybox'}, async () => {
	const dir = mkdtempSync(join(tmpdir(), 'homehook-'));
	const out = join(dir, 'fds');
	const watch = join(dir, 'watch.sh');
	// exec, so that the list is not muddled by the shell's own saved descriptors (dash keeps them at 10 and up)
	writeFileSync(watch, `#!/bin/sh\nexec ls /proc/self/fd > '${out}'\n`);
	chmodSync(watch, 0o755);
	// the hook runs the watcher as "$1", so its #! line picks the shell; it only lists its fds
	const hook = join(dir, '60-homehook');
	writeFileSync(hook, readFileSync(HOOK, 'utf8').replaceAll('/var/lib/homehook/watch.sh', watch).replaceAll('/var/lib/homehook/stadia.sh', join(dir, 'none')));
	// fds 11, 13 and 15 stand in for the sockets the Channel's node service passed on
	execFileSync('busybox', ['ash', '-c', `exec 11</dev/null 13</dev/null 15</dev/null; busybox ash '${hook}'`]);
	for (let i = 0; i < 50 && !(existsSync(out) && readFileSync(out, 'utf8').endsWith('\n')); i++) await new Promise((r) => setTimeout(r, 50));
	const fds = readFileSync(out, 'utf8').trim().split('\n').map(Number).filter((fd) => fd > 2);
	for (const fd of [11, 13, 15]) assert.ok(!fds.includes(fd), `fd ${fd} passed on: ${fds}`);
});

test('60-homehook parses in sh', () => {
	execFileSync('sh', ['-n', HOOK]);
});
