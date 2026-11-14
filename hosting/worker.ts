import type { InferEnv, UnwrapConfig } from 'cf/config';
import type config from '../cloudflare.config';

export type Env = InferEnv<UnwrapConfig<typeof config>['worker']>;

const CLIENT_ROUTE =
	/^\/(?:invite|game|record)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

function privateResponse(response: Response, method: string): Response {
	const headers = new Headers(response.headers);
	headers.set('Referrer-Policy', 'no-referrer');
	headers.set('X-Robots-Tag', 'noindex, nofollow');
	headers.set('X-Content-Type-Options', 'nosniff');
	headers.set('Cache-Control', 'no-store');
	return new Response(method === 'HEAD' ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return privateResponse(
				new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }),
				request.method,
			);
		}

		const url = new URL(request.url);
		if (url.pathname !== '/' && url.pathname !== '/record' && !CLIENT_ROUTE.test(url.pathname)) {
			return privateResponse(new Response('Not found', { status: 404 }), request.method);
		}

		url.pathname = '/index.html';
		url.search = '';
		url.hash = '';
		try {
			// Only the local asset binding receives this fresh, credential-free request.
			const response = await env.ASSETS.fetch(new Request(url, { method: request.method }));
			return privateResponse(response, request.method);
		} catch {
			return privateResponse(new Response('Unavailable', { status: 500 }), request.method);
		}
	},
};
