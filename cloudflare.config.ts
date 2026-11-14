import { bindings, defineConfig } from 'cf/config';

// This PR defines an isolated preview only. There is no production mode or domain binding.
export default defineConfig(({ mode }) => {
	if (mode !== 'cloudflare-preview') throw new Error('Use the cloudflare-preview mode');
	return {
		worker: {
			name: 'fortemate-choice-preview',
			compatibilityDate: '2026-11-14',
			entrypoint: './hosting/worker.ts',
			env: { ASSETS: bindings.assets() },
			assets: { htmlHandling: 'none', notFoundHandling: 'none' },
			observability: {
				enabled: true,
				redactQueryString: true,
				logs: { enabled: true, invocationLogs: false },
				traces: { enabled: true },
			},
		},
	};
});
