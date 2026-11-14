// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { privateApi as proxyPrivateApi, type PrivateApiBinding } from './private-api';

const ORIGIN = 'https://choice-preview-fixture.example.test';
const UUID = '01234567-89ab-cdef-0123-456789abcdef';

function fakeApi(
	response = new Response('fixture', { headers: { 'Content-Type': 'application/json' } }),
) {
	const fetch = vi.fn(async (_input: string, _init?: RequestInit) => response);
	const env = {
		PRIVATE_API: { fetch } as PrivateApiBinding,
		PREVIEW_ORIGIN: ORIGIN,
	};
	return { env, fetch };
}

function privateApi(request: Request, env: ReturnType<typeof fakeApi>['env']) {
	return proxyPrivateApi(request, env.PRIVATE_API, env.PREVIEW_ORIGIN);
}

function request(path: string, method = 'GET', headers: HeadersInit = {}) {
	return new Request(`${ORIGIN}${path}`, { method, headers });
}

function expectPrivateHeaders(response: Response) {
	expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
	expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(response.headers.get('Cache-Control')).toBe('no-store');
}

afterEach(() => vi.restoreAllMocks());

describe('private laboratory route boundary', () => {
	it.each([
		['/health', 'GET'],
		['/health', 'HEAD'],
		['/games', 'POST'],
		[`/games/${UUID}`, 'GET'],
		[`/games/${UUID.toUpperCase()}/moves`, 'GET'],
		[`/games/${UUID}/transcript`, 'GET'],
		[`/games/${UUID}/rematch`, 'POST'],
	])('forwards only %s %s through its fixed private binding', async (path, method) => {
		const globalFetch = vi.spyOn(globalThis, 'fetch');
		const { env, fetch } = fakeApi();
		const response = await privateApi(request(path, method, { Origin: ORIGIN }), env);
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0]).toBe(`http://choice-preview-api${path}`);
		expect(fetch.mock.calls[0][1]?.method).toBe(method);
		expect(fetch.mock.calls[0][1]?.redirect).toBe('manual');
		expect(globalFetch).not.toHaveBeenCalled();
		expectPrivateHeaders(response);
		if (method === 'HEAD') expect(response.body).toBeNull();
	});

	it.each([
		'/games',
		'/games/not-a-uuid',
		`/games/${UUID}/extra`,
		`/games/${UUID}/`,
		`/games/${UUID}/moves/extra`,
		'/lobby/seeks',
		'/ingest/games',
		'/api/games',
		'/leaderboard',
	])('blocks unknown paths or the wrong method on %s', async (path) => {
		const { env, fetch } = fakeApi();
		const response = await privateApi(request(path), env);
		expect(response.status).toBe(path === '/games' ? 405 : 404);
		expect(fetch).not.toHaveBeenCalled();
		expectPrivateHeaders(response);
	});

	it.each([
		['/health', 'POST', 'GET, HEAD'],
		[`/games/${UUID}`, 'DELETE', 'GET'],
		[`/games/${UUID}/moves`, 'POST', 'GET'],
		[`/games/${UUID}/transcript`, 'PUT', 'GET'],
		[`/games/${UUID}/rematch`, 'GET', 'POST'],
		[`/games/${UUID}/ws`, 'POST', 'GET'],
	])('returns 405 and the exact allowed methods for %s %s', async (path, method, allow) => {
		const { env, fetch } = fakeApi();
		const response = await privateApi(request(path, method, { Origin: ORIGIN }), env);
		expect(response.status).toBe(405);
		expect(response.headers.get('Allow')).toBe(allow);
		expect(fetch).not.toHaveBeenCalled();
	});

	it.each(['?token=fixture', '?', '#fixture', '#'])(
		'rejects API query/fragment %s before contacting a binding',
		async (suffix) => {
			const { env, fetch } = fakeApi();
			const response = await privateApi(request(`/games/${UUID}/ws${suffix}`), env);
			expect(response.status).toBe(400);
			expect(fetch).not.toHaveBeenCalled();
			expect(await response.text()).not.toContain('fixture');
		},
	);

	it.each(['/health', `/games/${UUID}`, `/games/${UUID}/moves`, `/games/${UUID}/transcript`])(
		'allows missing Origin only on a public read: %s',
		async (path) => {
			const { env, fetch } = fakeApi();
			expect((await privateApi(request(path), env)).status).toBe(200);
			expect(fetch).toHaveBeenCalledOnce();
		},
	);

	it.each([
		['/games', 'POST'],
		[`/games/${UUID}/rematch`, 'POST'],
		[`/games/${UUID}/ws`, 'GET'],
	])('requires exact Origin on %s %s', async (path, method) => {
		for (const origin of [undefined, 'null', 'https://other.example.test', `${ORIGIN}/`]) {
			const { env, fetch } = fakeApi();
			const headers = origin === undefined ? {} : { Origin: origin };
			expect((await privateApi(request(path, method, headers), env)).status).toBe(403);
			expect(fetch).not.toHaveBeenCalled();
		}
	});

	it('also rejects a foreign Origin on a public GET', async () => {
		const { env, fetch } = fakeApi();
		expect(
			(await privateApi(request('/health', 'GET', { Origin: 'https://other.example.test' }), env))
				.status,
		).toBe(403);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('streams POST bodies and forwards only the HTTP header allowlist', async () => {
		const { env, fetch } = fakeApi();
		const body = '{"rated":false}';
		await privateApi(
			new Request(`${ORIGIN}/games`, {
				method: 'POST',
				body,
				headers: {
					Origin: ORIGIN,
					Accept: 'application/json',
					'Content-Type': 'application/json',
					Cookie: 'fixture-cookie',
					Authorization: 'fixture-auth',
					'Cf-Access-Jwt-Assertion': 'fixture-access',
					'Cf-Access-Client-Id': 'fixture-id',
					'Cf-Access-Client-Secret': 'fixture-secret',
					'X-Forwarded-For': '192.0.2.1',
					'X-Private': 'fixture-private',
					'X-Laboratory-Seat-Token': 'fixture-seat',
				},
			}),
			env,
		);
		const init = fetch.mock.calls[0][1]!;
		expect([...new Headers(init.headers)]).toEqual([
			['accept', 'application/json'],
			['content-type', 'application/json'],
			['origin', ORIGIN],
		]);
		expect(await new Response(init.body).text()).toBe(body);
	});

	it('forwards the seat capability only on the explicit rematch route', async () => {
		for (const [path, method, expected] of [
			[`/games/${UUID}/rematch`, 'POST', 'fixture-seat'],
			[`/games/${UUID}/moves`, 'GET', null],
			[`/games/${UUID}/transcript`, 'GET', null],
		] as const) {
			const { env, fetch } = fakeApi();
			await privateApi(
				request(path, method, { Origin: ORIGIN, 'X-Laboratory-Seat-Token': 'fixture-seat' }),
				env,
			);
			expect(new Headers(fetch.mock.calls[0][1]?.headers).get('X-Laboratory-Seat-Token')).toBe(
				expected,
			);
		}
	});

	it('streams the original response body and preserves upstream status with private headers', async () => {
		const upstream = new Response(new ReadableStream(), {
			status: 409,
			headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public' },
		});
		const { env } = fakeApi(upstream);
		const response = await privateApi(request(`/games/${UUID}`), env);
		expect(response.status).toBe(409);
		expect(response.body).toBe(upstream.body);
		expect(upstream.bodyUsed).toBe(false);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expectPrivateHeaders(response);
	});

	it('strips Connection and its nominated fields from ordinary responses', async () => {
		const upstream = new Response('fixture', {
			headers: {
				Connection: ' X-Hop, , x-SECOND , keep-alive ',
				'X-Hop': 'first',
				'X-Second': 'second',
				'Keep-Alive': 'timeout=5',
				'Content-Type': 'application/json',
			},
		});
		const { env } = fakeApi(upstream);
		const response = await privateApi(request('/health'), env);
		for (const name of ['Connection', 'X-Hop', 'X-Second', 'Keep-Alive'])
			expect(response.headers.has(name)).toBe(false);
		expect(response.headers.get('Content-Type')).toBe('application/json');
		expect(await response.text()).toBe('fixture');
		expect(upstream.headers.get('X-Hop')).toBe('first');
		expectPrivateHeaders(response);
	});

	it('returns a redacted 502 without logging or falling back to global fetch', async () => {
		const log = vi.spyOn(console, 'log');
		const error = vi.spyOn(console, 'error');
		const globalFetch = vi.spyOn(globalThis, 'fetch');
		const { env, fetch } = fakeApi();
		fetch.mockRejectedValueOnce(new Error('fixture private upstream details'));
		const response = await privateApi(request('/health'), env);
		expect(response.status).toBe(502);
		expect(await response.text()).toBe('Private laboratory API unavailable');
		expectPrivateHeaders(response);
		expect(log).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
		expect(globalFetch).not.toHaveBeenCalled();
	});
});

describe('WebSocket handoff', () => {
	it.each([undefined, 'h2c'])(
		'rejects missing or unsupported Upgrade %s without contacting upstream',
		async (upgrade) => {
			const { env, fetch } = fakeApi();
			const headers: Record<string, string> = { Origin: ORIGIN };
			if (upgrade) headers.Upgrade = upgrade;
			const response = await privateApi(request(`/games/${UUID}/ws`, 'GET', headers), env);
			expect(response.status).toBe(426);
			expect(response.headers.get('Upgrade')).toBe('websocket');
			expect(fetch).not.toHaveBeenCalled();
		},
	);

	it('rejects an upgrade on an HTTP-only route', async () => {
		const { env, fetch } = fakeApi();
		expect(
			(await privateApi(request('/health', 'GET', { Upgrade: 'websocket' }), env)).status,
		).toBe(400);
		expect(fetch).not.toHaveBeenCalled();
	});

	it('returns the raw 101 endpoint and forwards only allowed handshake headers', async () => {
		// Node's Response constructor disallows 101; this models the binding's runtime response.
		const upstream = new Response(null, {
			headers: { Connection: 'Upgrade', Upgrade: 'websocket' },
		});
		const endpoint = Object.freeze({});
		Object.defineProperties(upstream, {
			status: { value: 101 },
			webSocket: { value: endpoint },
		});
		const { env, fetch } = fakeApi(upstream);
		const response = await privateApi(
			request(`/games/${UUID}/ws`, 'GET', {
				Origin: ORIGIN,
				Upgrade: 'websocket',
				Connection: 'Upgrade',
				'Sec-WebSocket-Key': 'fixture-key',
				'Sec-WebSocket-Version': '13',
				'Sec-WebSocket-Protocol': 'fixture-protocol',
				Cookie: 'fixture-cookie',
				Authorization: 'fixture-auth',
				'Cf-Access-Jwt-Assertion': 'fixture-access',
				'X-Laboratory-Seat-Token': 'fixture-seat',
			}),
			env,
		);
		expect(response).toBe(upstream);
		expect(response.headers.get('Connection')).toBe('Upgrade');
		expect(response.headers.get('Upgrade')).toBe('websocket');
		expect(Reflect.get(response, 'webSocket')).toBe(endpoint);
		expect([...new Headers(fetch.mock.calls[0][1]?.headers)]).toEqual([
			['connection', 'Upgrade'],
			['origin', ORIGIN],
			['sec-websocket-key', 'fixture-key'],
			['sec-websocket-protocol', 'fixture-protocol'],
			['sec-websocket-version', '13'],
			['upgrade', 'websocket'],
		]);
	});
});
