import { closedPreviewSettings } from './closed-preview.ts';
import { releaseSettings } from './release-settings.ts';

export const hostingModes = [
	'cloudflare-preview',
	'cloudflare-closed-preview',
	'cloudflare-release',
];

/** Build and provider configuration must resolve the same explicitly selected environment. */
export function deploymentSettings(
	mode: string | undefined,
	env: Record<string, string | undefined>,
) {
	if (!mode || !hostingModes.includes(mode)) {
		throw new Error('Use an explicit Cloudflare hosting mode');
	}
	const release = mode === 'cloudflare-release';
	const preview = mode === 'cloudflare-closed-preview' ? closedPreviewSettings(env) : null;
	const privateApi = release ? releaseSettings(env) : preview;
	return {
		workerName: release ? 'fortemate-choice' : 'fortemate-choice-preview',
		privateApi,
	};
}
