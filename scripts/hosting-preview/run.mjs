/** Qualify a clean candidate locally using the native Cloudflare adapter and a disposable API/DB. */
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, writeFile } from 'node:fs/promises';
import net from 'node:net';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { chromium } from '@playwright/test';
import { PilotEnvironment, ROOT, artifactDigest } from '../laboratory-pilot/environment.mjs';
import {
	PREVIEW_ORIGIN,
	API_ORIGIN,
	IMAGES,
	SERVER_REVISION,
} from '../laboratory-pilot/configuration.mjs';
import { runBrowserAcceptance } from '../laboratory-acceptance/browser.mjs';
import { verifyTranscript } from '../laboratory-acceptance/oracle.mjs';
import { qualification } from '../laboratory-acceptance/lifecycle.mjs';

const exec = promisify(execFile);
const output = resolve(ROOT, 'test-results/hosting-preview', `run-${Date.now()}`);
const env = new PilotEnvironment({ frontendOrigin: PREVIEW_ORIGIN });
const findings = [];
const startedAtUtc = new Date().toISOString();
let browser;
let server;
let result;
const removeHandlers = qualification.install(process, () => {
	void browser?.close().catch(() => {});
});
const pass = (scenario) => {
	qualification.throwIfStopped();
	findings.push({ scenario, status: 'PASS' });
	process.stdout.write(`PASS ${scenario}\n`);
};
const git = async (...args) => (await exec('git', args, { cwd: ROOT })).stdout.trim();
const sourceStatus = () => git('status', '--porcelain', '--untracked-files=all');
const gameRequest = () => ({
	white: randomUUID(),
	black: randomUUID(),
	timeControl: { Unlimited: {} },
	variant: { id: 'choice-2x2d6', revision: 1 },
	labProtocolVersion: 1,
	rated: false,
});

async function build(script) {
	await exec('npm', ['run', script], {
		cwd: ROOT,
		env: { ...process.env, VITE_LAB_API_URL: API_ORIGIN, CHOICE_PREVIEW_API_URL: API_ORIGIN },
		maxBuffer: 8 * 1024 * 1024,
	});
	qualification.throwIfStopped();
}

async function startPreview() {
	const portFree = await new Promise((done) => {
		const socket = net.connect(8787, '127.0.0.1');
		socket.once('connect', () => {
			socket.destroy();
			done(false);
		});
		socket.once('error', () => done(true));
	});
	assert.ok(portFree, 'Preview port is occupied; refusing to reuse a service');
	server = spawn(
		process.execPath,
		['node_modules/vite/bin/vite.js', 'preview', '--mode', 'cloudflare-preview'],
		{
			cwd: ROOT,
			detached: true,
			stdio: 'ignore',
			env: { ...process.env, CHOICE_PREVIEW_API_URL: API_ORIGIN },
		},
	);
	const exited = once(server, 'exit');
	for (let attempt = 0; attempt < 120; attempt++) {
		qualification.throwIfStopped();
		assert.equal(server.exitCode, null, 'Native preview exited before readiness');
		try {
			const response = await fetch(PREVIEW_ORIGIN, { signal: AbortSignal.timeout(1000) });
			if (response.status === 200) return;
		} catch {
			/* Wait only for the process owned by this runner. */
		}
		await Promise.race([exited, new Promise((done) => setTimeout(done, 250))]);
	}
	throw new Error('Native preview did not become ready');
}

async function stopPreview() {
	if (!server?.pid) return;
	// Signal our process group even if Vite exited before its workerd children.
	const signalGroup = (signal) => {
		try {
			process.kill(-server.pid, signal);
			return true;
		} catch (error) {
			if (error.code === 'ESRCH') return false;
			throw error;
		}
	};
	for (const signal of ['SIGTERM', 'SIGKILL']) {
		if (!signalGroup(signal)) return;
		for (let attempt = 0; attempt < 20; attempt++) {
			await new Promise((done) => setTimeout(done, 250));
			if (!signalGroup(0)) return;
		}
	}
	throw new Error('Owned native preview process group survived cleanup');
}

async function incompleteFixture() {
	await env.restart({ admission: true, join: 2 });
	const response = await env.request('/games', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: gameRequest(),
	});
	assert.equal(response.status, 201);
	const room = response.json();
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	try {
		const page = await context.newPage();
		await page.goto(PREVIEW_ORIGIN);
		await page.evaluate(
			async ({ room, api }) => {
				await new Promise((done, reject) => {
					const url = new URL(`/games/${room.gameId}/ws`, api);
					url.protocol = 'wss:';
					const socket = new WebSocket(url);
					const timer = setTimeout(() => {
						socket.close();
						reject(new Error('Incomplete fixture timed out'));
					}, 12000);
					socket.onopen = () =>
						socket.send(
							JSON.stringify({
								LabAuthenticate: {
									token: room.tokens.find((t) => t.seat === 'White').token,
									guest: crypto.randomUUID(),
								},
							}),
						);
					socket.onmessage = (message) => {
						const event = JSON.parse(message.data);
						if (event.LabAuthenticated)
							socket.send(JSON.stringify({ SubmitSeed: { seed: 'preview-incomplete-white' } }));
						if (event.GameEnded) {
							clearTimeout(timer);
							socket.close();
							done();
						}
					};
				});
			},
			{ room, api: API_ORIGIN },
		);
	} finally {
		await context.close();
	}
	assert.equal(
		(await env.request(`/games/${room.gameId}/transcript`)).json().completeness,
		'incomplete',
	);
	await env.restart({ admission: true });
	return room;
}

try {
	await mkdir(output, { recursive: true });
	assert.equal(
		process.platform,
		'linux',
		'Run the native hosting qualification on Linux or inside WSL',
	);
	assert.equal(await sourceStatus(), '', 'Commit the candidate before qualification');
	const sourceRevision = await git('rev-parse', 'HEAD');
	await build('build');
	await build('build:hosting');
	await build('check:hosting');
	const hostingArtifact = resolve(ROOT, '.cloudflare/output/v0');
	const artifactSha256 = await artifactDigest(hostingArtifact);
	pass('clean-candidate-native-cloudflare-build-and-typecheck');
	await env.setup();
	assert.equal((await env.request('/health')).json().rulesVersion, '0.18.2');
	assert.equal(
		(
			await env.docker([
				'image',
				'inspect',
				IMAGES.api,
				'--format',
				'{{index .Config.Labels "org.opencontainers.image.revision"}}',
			])
		).stdout.trim(),
		SERVER_REVISION,
	);
	assert.equal(await env.sql('SELECT count(*) FROM laboratory.games'), '0');
	assert.equal(
		await env.sql(
			"SELECT has_database_privilege('laboratory_app','postgres','CONNECT')",
			'postgres',
		),
		'f',
	);
	const allowed = await env.request('/health', { headers: { Origin: PREVIEW_ORIGIN } });
	assert.equal(allowed.headers['access-control-allow-origin'], PREVIEW_ORIGIN);
	assert.equal(
		(await env.request('/health', { headers: { Origin: 'https://unapproved.example' } })).status,
		403,
	);
	pass('disposable-postgresql-api-and-exact-preview-cors');
	await startPreview();
	pass('owned-loopback-native-preview');
	browser = await chromium.launch({ headless: true });
	const incompleteRoom = await incompleteFixture();
	const evidence = await runBrowserAcceptance({
		browser: {
			newContext: (options) => browser.newContext({ ...options, ignoreHTTPSErrors: true }),
		},
		appOrigin: PREVIEW_ORIGIN,
		apiOrigin: API_ORIGIN,
		incompleteRoom,
		outputDir: output,
		disconnect: () => env.compose(['stop', '--timeout', '20', 'api']),
		restart: async (id) => {
			assert.match(id, /^[0-9a-f-]{36}$/);
			const saved = JSON.parse(
				await env.sql(`SELECT snapshot FROM laboratory.games WHERE game_id='${id}'::uuid`),
			);
			const waiting = saved.lab.turn.phase === 'AwaitingPlayers';
			await env.restart({ admission: !waiting });
			const restored = (await env.request(`/games/${id}`)).json();
			const bank = { white: saved.remainingMs.White, black: saved.remainingMs.Black };
			for (const side of ['white', 'black']) {
				assert.ok(restored.clocks[side] <= bank[side]);
				assert.ok(restored.clocks[side] >= bank[side] - 10000);
			}
			return {
				savedClocks: bank,
				restoredClocks: restored.clocks,
				sampledAt: performance.now(),
				activeSeat: restored.activeSeat,
			};
		},
	});
	findings.push(...evidence.findings);
	assert.ok(
		findings.every((finding) => finding.status === 'PASS'),
		'Browser qualification failed; see redacted findings',
	);
	assert.equal(verifyTranscript(evidence.terminalRecord).status, 'verified');
	pass('independent-transcript-verification');
	assert.equal(await sourceStatus(), '', 'Candidate changed during qualification');
	assert.equal(await git('rev-parse', 'HEAD'), sourceRevision);
	assert.equal(
		await artifactDigest(hostingArtifact),
		artifactSha256,
		'Native preview modified the build artifact',
	);
	result = {
		schemaVersion: 1,
		status: 'PASS',
		publicDeployment: false,
		clientSourceRevision: sourceRevision,
		hostingArtifactSha256: artifactSha256,
		serverRevision: SERVER_REVISION,
		images: IMAGES,
		postgres: await env.sql('SHOW server_version'),
		chromium: browser.version(),
		scenarios: findings,
	};
} catch (error) {
	result = {
		schemaVersion: 1,
		status: 'FAIL',
		failure: String(error.message)
			.replace(/https?:\/\/[^\s)]+/g, '[url]')
			.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
			.slice(0, 300),
		scenarios: findings,
	};
	process.exitCode = qualification.exitCode ?? 1;
} finally {
	try {
		await qualification.shutdown(async () => {
			const results = await Promise.allSettled([browser?.close(), stopPreview(), env.cleanup()]);
			assert.ok(
				results.every((entry) => entry.status === 'fulfilled'),
				'Owned preview cleanup failed',
			);
		});
		result.cleanup = 'PASS';
	} catch {
		result.status = 'FAIL';
		result.cleanup = 'FAIL';
		process.exitCode = 1;
	}
	removeHandlers();
	if (qualification.stopped) {
		result.status = 'INTERRUPTED';
		process.exitCode = qualification.exitCode;
	}
	result.startedAtUtc = startedAtUtc;
	result.completedAtUtc = new Date().toISOString();
	await writeFile(resolve(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
	process.stdout.write(
		`Hosting qualification ${result.status}; report: ${resolve(output, 'results.json')}\n`,
	);
}
