import type { InferEnv, UnwrapConfig } from 'cf/config';
import type config from '../cloudflare.config';
import { privateApi, privateResponse } from './private-api';

export type Env = InferEnv<UnwrapConfig<typeof config>['worker']>;

const CLIENT_ROUTE =
	/^\/(?:invite|game|record)\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const clientRoute =
			url.pathname === '/' || url.pathname === '/record' || CLIENT_ROUTE.test(url.pathname);
		if (env.PRIVATE_API && !clientRoute) {
			if (!env.PREVIEW_ORIGIN)
				return privateResponse(
					new Response('Preview configuration unavailable', { status: 503 }),
					request.method,
				);
			return privateApi(request, env.PRIVATE_API, env.PREVIEW_ORIGIN);
		}
		if (request.method !== 'GET' && request.method !== 'HEAD') {
			return privateResponse(
				new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } }),
				request.method,
			);
		}

		if (!clientRoute) {
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
