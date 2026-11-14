import type { Env } from './worker';

export type PrivateApiBinding = NonNullable<Env['PRIVATE_API']>;

const GAME_PATH =
	/^\/games\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}(?:\/(moves|transcript|rematch|ws))?$/;

export function privateResponse(response: Response, method: string): Response {
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

function route(
	pathname: string,
): { methods: string[]; socket?: boolean; rematch?: boolean } | null {
	if (pathname === '/health') return { methods: ['GET', 'HEAD'] };
	if (pathname === '/games') return { methods: ['POST'] };
	const match = GAME_PATH.exec(pathname);
	if (!match) return null;
	if (match[1] === 'ws') return { methods: ['GET'], socket: true };
	if (match[1] === 'rematch') return { methods: ['POST'], rematch: true };
	return { methods: ['GET'] };
}

function upstreamHeaders(request: Request, target: NonNullable<ReturnType<typeof route>>): Headers {
	const headers = new Headers();
	const allowed = ['Content-Type', 'Accept', 'Origin'];
	if (target.socket)
		allowed.push(
			'Upgrade',
			'Connection',
			'Sec-WebSocket-Key',
			'Sec-WebSocket-Version',
			'Sec-WebSocket-Protocol',
		);
	if (target.rematch) allowed.push('X-Laboratory-Seat-Token');
	for (const name of allowed) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return headers;
}

/** Forward the laboratory allowlist through its configured private service binding. */
export async function privateApi(
	request: Request,
	binding: PrivateApiBinding,
	previewOrigin: NonNullable<Env['PREVIEW_ORIGIN']>,
): Promise<Response> {
	const respond = (message: string, status: number, headers?: HeadersInit) =>
		privateResponse(new Response(message, { status, headers }), request.method);
	const url = new URL(request.url);
	if (/[?#]/.test(url.href)) return respond('API query strings and fragments are not allowed', 400);
	const target = route(url.pathname);
	if (!target) return respond('Not found', 404);
	if (!target.methods.includes(request.method))
		return respond('Method not allowed', 405, { Allow: target.methods.join(', ') });
	const origin = request.headers.get('Origin');
	if (
		(origin !== null && origin !== previewOrigin) ||
		((request.method === 'POST' || target.socket) && origin === null)
	)
		return respond('A matching preview Origin is required', 403);
	const upgrade = request.headers.get('Upgrade');
	if (target.socket && upgrade?.toLowerCase() !== 'websocket')
		return respond('WebSocket upgrade required', 426, { Upgrade: 'websocket' });
	if (!target.socket && upgrade !== null)
		return respond('WebSocket upgrades require a game socket route', 400);

	const headers = upstreamHeaders(request, target);
	try {
		const response = await binding.fetch(`http://choice-preview-api${url.pathname}`, {
			method: request.method,
			headers,
			body: request.method === 'POST' ? request.body : undefined,
			redirect: 'manual',
			signal: request.signal,
		});
		// Reconstructing an upgrade response drops its WebSocket endpoint.
		if (target.socket && response.status === 101) return response;
		return privateResponse(response, request.method);
	} catch {
		return respond('Private laboratory API unavailable', 502);
	}
}
