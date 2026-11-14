import { expect, test, type APIResponse } from '@playwright/test';

const UUID = '01234567-89ab-cdef-0123-456789abcdef';

function expectPrivateHeaders(response: APIResponse) {
	const headers = response.headers();
	expect(headers['referrer-policy']).toBe('no-referrer');
	expect(headers['x-robots-tag']).toBe('noindex, nofollow');
	expect(headers['x-content-type-options']).toBe('nosniff');
	expect(headers['cache-control']).toBe('no-store');
}

test('native assets and their HEAD responses retain content types and security headers', async ({
	request,
}) => {
	const shell = await request.get('/');
	expect(shell.status()).toBe(200);
	expectPrivateHeaders(shell);
	const html = await shell.text();
	expect(html).toContain('<div id="laboratory">');
	const script = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
	const stylesheet = html.match(/<link[^>]+href="([^"]+\.css)"/)?.[1];
	expect(script).toMatch(/^\/assets\/[^/]+\.js$/);
	expect(stylesheet).toMatch(/^\/assets\/[^/]+\.css$/);
	for (const [path, contentType] of [
		[script!, /javascript/],
		[stylesheet!, /text\/css/],
		['/favicon.svg', /image\/svg\+xml/],
		['/pieces/cburnett/wK.svg', /image\/svg\+xml/],
		['/robots.txt', /text\/plain/],
	] as const) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(response.headers()['content-type'], path).toMatch(contentType);
		expectPrivateHeaders(response);
		expect((await response.body()).length, path).toBeGreaterThan(0);
		const head = await request.head(path);
		expect(head.status(), path).toBe(200);
		expect(head.headers()['content-type'], path).toMatch(contentType);
		expectPrivateHeaders(head);
		expect(await head.body()).toHaveLength(0);
	}
	const robots = await request.get('/robots.txt');
	expect(await robots.text()).toBe('User-agent: *\nDisallow: /\n');
});

test('only recognized deep links receive the same shell with private GET and HEAD responses', async ({
	request,
}) => {
	const shell = await (await request.get('/')).text();
	for (const path of [
		'/record',
		`/invite/${UUID}`,
		`/game/${UUID}`,
		`/record/${UUID}`,
		`/game/${UUID.toUpperCase()}`,
		`/invite/${UUID}?example=fixture`,
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(200);
		expect(response.headers()['content-type'], path).toContain('text/html');
		expectPrivateHeaders(response);
		expect(await response.text(), path).toBe(shell);
		const head = await request.head(path);
		expect(head.status(), path).toBe(200);
		expectPrivateHeaders(head);
		expect(await head.body()).toHaveLength(0);
	}
});

test('missing files, invalid routes and private platform files never receive the SPA', async ({
	request,
}) => {
	for (const path of [
		'/missing.js',
		'/assets/missing.css',
		'/pieces/missing.svg',
		'/nested/pieces/missing.svg',
		'/game/missing.js',
		`/game/${UUID}.js`,
		'/api/games',
		'/unknown',
		'/invite/not-a-uuid',
		`/game/${UUID}/extra`,
		'/_headers',
		'/_redirects',
		'/cloudflare.config.ts',
		'/hosting/worker.ts',
	]) {
		const response = await request.get(path);
		expect(response.status(), path).toBe(404);
		expectPrivateHeaders(response);
		expect(await response.text(), path).not.toContain('<div id="laboratory">');
		const head = await request.head(path);
		expect(head.status(), path).toBe(404);
		expectPrivateHeaders(head);
		expect(await head.body()).toHaveLength(0);
	}
});

test('non-read methods fail closed on client routes and unknown paths', async ({ request }) => {
	for (const path of ['/', `/game/${UUID}`, '/missing.js']) {
		for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
			const response = await request.fetch(path, { method });
			expect(response.status(), `${method} ${path}`).toBe(405);
			expect(response.headers().allow).toBe('GET, HEAD');
			expectPrivateHeaders(response);
		}
	}
});

test('native assets reject OPTIONS without exposing a credentialed cross-origin API', async ({
	request,
}) => {
	// Existing assets are handled by Cloudflare itself rather than the fallback Worker.
	for (const path of ['/favicon.svg', '/pieces/cburnett/wK.svg', '/robots.txt']) {
		const response = await request.fetch(path, {
			method: 'OPTIONS',
			maxRedirects: 0,
			headers: {
				Origin: 'https://example.test',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'authorization,content-type',
			},
		});
		expect(response.status(), path).toBe(405);
		expect(await response.body(), path).toHaveLength(0);
		expectPrivateHeaders(response);
		const headers = response.headers();
		expect(headers['access-control-allow-origin'], path).toBeUndefined();
		expect(headers['access-control-allow-credentials'], path).toBeUndefined();
		expect(headers.location, path).toBeUndefined();
	}
});
