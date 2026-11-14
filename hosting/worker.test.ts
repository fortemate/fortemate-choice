// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './worker';

const UUID = '01234567-89ab-cdef-0123-456789abcdef';

function fakeAssets(response = new Response('<main>Choice</main>')) {
	const fetch = vi.fn(async (_request: Request) => response);
	return { env: { ASSETS: { fetch } } as Env, fetch };
}

function expectPrivateHeaders(response: Response) {
	expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
	expect(response.headers.get('X-Robots-Tag')).toBe('noindex, nofollow');
	expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
	expect(response.headers.get('Cache-Control')).toBe('no-store');
}

afterEach(() => vi.restoreAllMocks());

describe('client route fallback', () => {
	it.each([
		'/',
		'/record',
		`/invite/${UUID}`,
		`/game/${UUID}`,
		`/record/${UUID}`,
		`/invite/${UUID.toUpperCase()}`,
		`/game/${UUID.toUpperCase()}`,
		`/record/${UUID.toUpperCase()}`,
	])('serves the application only for %s', async (path) => {
		const { env, fetch } = fakeAssets();
		const response = await worker.fetch(new Request(`http://localhost${path}`), env);
		expect(fetch).toHaveBeenCalledOnce();
		expect(fetch.mock.calls[0][0].url).toBe('http://localhost/index.html');
		expect(fetch.mock.calls[0][0].method).toBe('GET');
		expect(response.status).toBe(200);
		expectPrivateHeaders(response);
		expect(await response.text()).toBe('<main>Choice</main>');
	});

	it.each([
		'/unknown',
		'/invite',
		'/game',
		'/record/',
		`/game/${UUID}/`,
		`/game/${UUID}/extra`,
		`/GAME/${UUID}`,
		`/invite/${UUID.slice(1)}`,
		`/record/${UUID}g`,
		`/game/${UUID.replace('a', 'g')}`,
		'/record/not-a-uuid',
		'/index.html',
		'/missing.js',
		'/assets/missing.css',
		'/pieces/missing.svg',
		'/nested/pieces/white/king.svg',
		'/game/missing.js',
		`/game/${UUID}.js`,
		'/favicon.ico',
		'/robots.txt',
		'/api/game',
	])('returns 404 without consulting assets for %s', async (path) => {
		const { env, fetch } = fakeAssets();
		const response = await worker.fetch(new Request(`http://localhost${path}`), env);
		expect(response.status).toBe(404);
		expect(fetch).not.toHaveBeenCalled();
		expectPrivateHeaders(response);
		expect(await response.text()).toBe('Not found');
	});

	it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])(
		'rejects %s before routing or assets',
		async (method) => {
			const { env, fetch } = fakeAssets();
			for (const path of ['/', '/missing.js']) {
				const response = await worker.fetch(
					new Request(`http://localhost${path}`, { method }),
					env,
				);
				expect(response.status).toBe(405);
				expect(response.headers.get('Allow')).toBe('GET, HEAD');
				expect(fetch).not.toHaveBeenCalled();
				expectPrivateHeaders(response);
			}
		},
	);

	it('keeps HEAD when fetching the shell and returns no body', async () => {
		const { env, fetch } = fakeAssets(
			new Response(null, { headers: { 'Content-Type': 'text/html' } }),
		);
		const response = await worker.fetch(
			new Request(`http://localhost/game/${UUID}`, { method: 'HEAD' }),
			env,
		);
		expect(fetch.mock.calls[0][0].method).toBe('HEAD');
		expect(response.body).toBeNull();
		expect(response.headers.get('Content-Type')).toBe('text/html');
		expectPrivateHeaders(response);
	});

	it('returns an empty private HEAD 404', async () => {
		const { env, fetch } = fakeAssets();
		const response = await worker.fetch(
			new Request('http://localhost/missing.js', { method: 'HEAD' }),
			env,
		);
		expect(response.status).toBe(404);
		expect(response.body).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expectPrivateHeaders(response);
	});

	it('strips query, fragment, and caller headers without making an upstream request or logging', async () => {
		const upstream = vi.spyOn(globalThis, 'fetch');
		const log = vi.spyOn(console, 'log');
		const error = vi.spyOn(console, 'error');
		const { env, fetch } = fakeAssets();
		await worker.fetch(
			new Request(`http://localhost/invite/${UUID}?ignored=example#example`, {
				headers: {
					Cookie: 'example=value',
					Authorization: 'example',
					Referer: 'http://localhost/source',
				},
			}),
			env,
		);
		const assetRequest = fetch.mock.calls[0][0];
		expect(assetRequest.url).toBe('http://localhost/index.html');
		expect([...assetRequest.headers]).toEqual([]);
		expect(upstream).not.toHaveBeenCalled();
		expect(log).not.toHaveBeenCalled();
		expect(error).not.toHaveBeenCalled();
	});

	it('passes the asset stream through without consuming it and overrides cache and privacy headers', async () => {
		const assetResponse = new Response(new ReadableStream(), {
			headers: {
				'Content-Type': 'text/html',
				'Cache-Control': 'public, max-age=3600',
				'Referrer-Policy': 'unsafe-url',
				'X-Robots-Tag': 'index, follow',
				'X-Content-Type-Options': 'example',
			},
		});
		const { env } = fakeAssets(assetResponse);
		const response = await worker.fetch(new Request('http://localhost/'), env);
		expect(response.body).toBe(assetResponse.body);
		expect(assetResponse.bodyUsed).toBe(false);
		expect(response.headers.get('Content-Type')).toBe('text/html');
		expectPrivateHeaders(response);
	});

	it.each([404, 500])('preserves asset status %i and applies privacy headers', async (status) => {
		const { env } = fakeAssets(new Response('Asset unavailable', { status }));
		const response = await worker.fetch(new Request('http://localhost/record'), env);
		expect(response.status).toBe(status);
		expectPrivateHeaders(response);
		expect(await response.text()).toBe('Asset unavailable');
	});

	it.each(['GET', 'HEAD'])(
		'fails closed on binding exceptions for %s without revealing or logging the error',
		async (method) => {
			const error = vi.spyOn(console, 'error');
			const { env, fetch } = fakeAssets();
			fetch.mockRejectedValueOnce(new Error('internal example details'));
			const response = await worker.fetch(new Request('http://localhost/', { method }), env);
			expect(response.status).toBe(500);
			expectPrivateHeaders(response);
			expect(await response.text()).toBe(method === 'HEAD' ? '' : 'Unavailable');
			expect(error).not.toHaveBeenCalled();
		},
	);
});
