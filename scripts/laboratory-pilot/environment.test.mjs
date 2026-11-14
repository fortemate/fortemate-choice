/** Verify cleanup ownership boundaries and artifact identity without starting services. */
import test from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PilotEnvironment, artifactDigest } from './environment.mjs';
import { APP_ORIGIN, PREVIEW_ORIGIN } from './configuration.mjs';

test('frontend defaults to the existing TLS gateway and accepts only the isolated preview', () => {
	assert.equal(new PilotEnvironment().frontendOrigin, APP_ORIGIN);
	assert.equal(new PilotEnvironment({}).frontendOrigin, APP_ORIGIN);
	assert.equal(
		new PilotEnvironment({ frontendOrigin: PREVIEW_ORIGIN }).frontendOrigin,
		PREVIEW_ORIGIN,
	);
	for (const frontendOrigin of [
		'https://public.example',
		'http://localhost:8787',
		'http://127.0.0.1:8788',
		`${PREVIEW_ORIGIN}/`,
	]) {
		assert.throws(() => new PilotEnvironment({ frontendOrigin }));
	}
});

test('preview selection does not permit HTTP or public origins in the TLS request helper', async () => {
	const env = new PilotEnvironment({ frontendOrigin: PREVIEW_ORIGIN });
	await assert.rejects(() => env.request('/health', { origin: PREVIEW_ORIGIN }));
	await assert.rejects(() => env.request('/health', { origin: 'https://public.example' }));
});

test('native command launch preserves literal arguments and cannot enable a shell', async () => {
	const env = new PilotEnvironment();
	env.wsl = null;
	const literal = 'lab229 space ; $(printf altered) "quoted"';
	const result = await env.linux(
		process.execPath,
		['-e', 'process.stdout.write(process.argv[1])', literal],
		{ shell: true },
	);
	assert.equal(result.stdout, literal);
});

test('cleanup refuses to remove a volume whose ownership label differs', async () => {
	const env = new PilotEnvironment();
	env.owned = true;
	const calls = [];
	env.compose = async (args) => {
		calls.push(args);
		return { stdout: '' };
	};
	env.docker = async (args) => {
		calls.push(args);
		return { stdout: args[1] === 'ls' ? `${env.project}_laboratory-data` : 'another-project' };
	};
	await assert.rejects(() => env.cleanup());
	assert.equal(
		calls.some((args) => args[0] === 'volume' && args[1] === 'rm'),
		false,
	);
});

test('cleanup removes only its claimed project volume after a preserving shutdown', async () => {
	const env = new PilotEnvironment();
	env.owned = true;
	const calls = [];
	env.compose = async (args) => {
		calls.push(args);
		return { stdout: '' };
	};
	env.docker = async (args) => {
		calls.push(args);
		return {
			stdout:
				args[0] !== 'volume'
					? ''
					: args[1] === 'ls'
						? `${env.project}_laboratory-data`
						: args[1] === 'inspect'
							? env.project
							: '',
		};
	};
	await env.cleanup();
	assert.deepEqual(calls[0], ['down', '--timeout', '20']);
	assert.deepEqual(
		calls.filter((args) => args[0] === 'volume' && args[1] === 'rm'),
		[['volume', 'rm', `${env.project}_laboratory-data`]],
	);
});

test('cleanup tolerates an interrupted startup that never created its volume', async () => {
	const env = new PilotEnvironment();
	env.owned = true;
	const calls = [];
	env.compose = async () => ({ stdout: '' });
	env.docker = async (args) => {
		calls.push(args);
		return { stdout: '' };
	};
	await env.cleanup();
	assert.equal(
		calls.some((args) => args[0] === 'volume' && ['rm', 'inspect'].includes(args[1])),
		false,
	);
});

test('artifact identity is independent of directory location and changes with bytes or names', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lab229-unit-'));
	try {
		for (const name of ['a', 'b']) {
			await mkdir(join(root, name));
			await writeFile(join(root, name, 'index.html'), 'same artifact');
		}
		const digest = await artifactDigest(join(root, 'a'));
		assert.equal(await artifactDigest(join(root, 'b')), digest);
		await writeFile(join(root, 'b', 'index.html'), 'changed artifact');
		assert.notEqual(await artifactDigest(join(root, 'b')), digest);
		await writeFile(join(root, 'a', 'extra.js'), 'same artifact');
		assert.notEqual(await artifactDigest(join(root, 'a')), digest);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});

test('artifact digest keeps byte-sorted order across nested directories', async () => {
	const root = await mkdtemp(join(tmpdir(), 'lab229-unit-'));
	try {
		const files = new Map([
			['a.txt', 'sibling'],
			['a/child.txt', 'child'],
			['nested/a.txt', 'nested first'],
			['nested/z.txt', 'nested last'],
			['z.txt', 'last'],
		]);
		for (const [name, content] of files) {
			await mkdir(join(root, name, '..'), { recursive: true });
			await writeFile(join(root, name), content);
		}

		const entries = [
			['a/child.txt', files.get('a/child.txt')],
			['a.txt', files.get('a.txt')],
			['nested/a.txt', files.get('nested/a.txt')],
			['nested/z.txt', files.get('nested/z.txt')],
			['z.txt', files.get('z.txt')],
		]
			.map(([name, content]) => `${createHash('sha256').update(content).digest('hex')}  ${name}\n`)
			.join('');
		const expected = createHash('sha256').update(entries).digest('hex');
		assert.equal(await artifactDigest(root), expected);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
