import { privateServiceId } from './service-id.ts';

/** Release coordinates never fall back to the preview or an existing game service. */
export function releaseSettings(env: Record<string, string | undefined>) {
	const value = env.CHOICE_RELEASE_ORIGIN ?? '';
	const url = new URL(value);
	const hostname = /^choice\.(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
	if (
		value !== value.trim() ||
		url.protocol !== 'https:' ||
		!hostname.test(url.hostname) ||
		['local', 'localhost', 'internal'].includes(url.hostname.split('.').at(-1) ?? '') ||
		url.username ||
		url.password ||
		url.port ||
		url.pathname !== '/' ||
		/[?#]/.test(value)
	) {
		throw new Error('Release requires a dedicated HTTPS choice.<domain> origin');
	}
	return { origin: url.origin, serviceId: privateServiceId(env.CHOICE_RELEASE_VPC_SERVICE_ID) };
}
