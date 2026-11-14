/** Positive preview naming rule; there is no fallback to any existing/public game API. */
export function previewOrigin(value: string): string {
	const url = new URL(value);
	const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
	if (
		url.username ||
		url.password ||
		url.search ||
		url.hash ||
		url.pathname !== '/' ||
		(!local && !url.hostname.startsWith('choice-preview-')) ||
		(local ? !['http:', 'https:'].includes(url.protocol) : url.protocol !== 'https:')
	) {
		throw new Error(
			'Preview API must be a dedicated HTTPS choice-preview host or a loopback fixture',
		);
	}
	return url.origin;
}
