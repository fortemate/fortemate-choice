/** Exercise fixture authentication, origins and cleanup without starting local services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_ORIGIN, PREVIEW_ORIGIN, API_ORIGIN } from './configuration.mjs';
import { gameRequest, incompleteFixture } from './fixtures.mjs';

test('room requests retain the isolated unlimited variant and distinct participant ids', () => {
	const first = gameRequest();
	const second = gameRequest();
	assert.notEqual(first.white, first.black);
	assert.notEqual(first.white, second.white);
	assert.notEqual(first.black, second.black);
	assert.deepEqual(
		{ ...first, white: undefined, black: undefined },
		{
			white: undefined,
			black: undefined,
			timeControl: { Unlimited: {} },
			variant: { id: 'choice-2x2d6', revision: 1 },
			labProtocolVersion: 1,
			rated: false,
		},
	);
});

for (const [appOrigin, seed] of [
	[APP_ORIGIN, 'pilot-incomplete-white'],
	[PREVIEW_ORIGIN, 'preview-incomplete-white'],
]) {
	test(`incomplete fixture retains first-frame authentication and its seed from ${appOrigin}`, async () => {
		const room = { gameId: 'fixture-room', tokens: [{ seat: 'White', token: 'fixture-white' }] };
		const calls = [];
		const frames = [];
		const originalWebSocket = globalThis.WebSocket;
		globalThis.WebSocket = class {
			constructor(url) {
				assert.equal(
					url.toString(),
					`${API_ORIGIN.replace('https:', 'wss:')}/games/fixture-room/ws`,
				);
				queueMicrotask(() => this.onopen());
			}
			send(raw) {
				const frame = JSON.parse(raw);
				frames.push(frame);
				const event = frame.LabAuthenticate ? { LabAuthenticated: {} } : { GameEnded: {} };
				queueMicrotask(() => this.onmessage({ data: JSON.stringify(event) }));
			}
			close() {
				calls.push('socket-closed');
			}
		};
		const env = {
			restart: async (options) => calls.push(['restart', options]),
			request: async (path, options) => {
				calls.push(['request', path]);
				if (path === '/games') {
					assert.equal(options.method, 'POST');
					assert.equal(options.headers['Content-Type'], 'application/json');
					assert.deepEqual(options.body.variant, { id: 'choice-2x2d6', revision: 1 });
					return { status: 201, json: () => room };
				}
				return { json: () => ({ completeness: 'incomplete', fairness: null }) };
			},
		};
		const browser = {
			newContext: async (options) => {
				assert.deepEqual(options, { ignoreHTTPSErrors: true });
				return {
					newPage: async () => ({
						goto: async (origin) => assert.equal(origin, appOrigin),
						evaluate: (callback, args) => callback(args),
					}),
					close: async () => calls.push('context-closed'),
				};
			},
		};
		try {
			assert.equal(await incompleteFixture({ env, browser, appOrigin, seed }), room);
		} finally {
			globalThis.WebSocket = originalWebSocket;
		}
		assert.equal(frames.length, 2);
		assert.equal(frames[0].LabAuthenticate.token, 'fixture-white');
		assert.match(frames[0].LabAuthenticate.guest, /^[0-9a-f-]{36}$/);
		assert.deepEqual(frames[1], { SubmitSeed: { seed } });
		assert.deepEqual(calls, [
			['restart', { admission: true, join: 2 }],
			['request', '/games'],
			'socket-closed',
			'context-closed',
			['request', '/games/fixture-room/transcript'],
			['restart', { admission: true }],
		]);
	});
}

test('fixture refuses a public frontend before restarting the disposable API', async () => {
	await assert.rejects(() =>
		incompleteFixture({
			env: {},
			browser: {},
			appOrigin: 'https://public.example',
			seed: 'fixture',
		}),
	);
});

test('fixture closes its context when the browser journey rejects', async () => {
	let closed = false;
	const failure = new Error('fixture evaluation failed');
	const env = {
		restart: async () => {},
		request: async () => ({ status: 201, json: () => ({ gameId: 'fixture-room' }) }),
	};
	const browser = {
		newContext: async () => ({
			newPage: async () => ({
				goto: async () => {},
				evaluate: async () => {
					throw failure;
				},
			}),
			close: async () => {
				closed = true;
			},
		}),
	};
	await assert.rejects(
		() => incompleteFixture({ env, browser, appOrigin: APP_ORIGIN, seed: 'fixture' }),
		(error) => error === failure,
	);
	assert.equal(closed, true);
});
