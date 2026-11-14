import { bindings, defineConfig } from 'cf/config';
import { closedPreviewSettings } from './hosting/closed-preview.ts';

// Local asset verification and an explicitly configured closed deployment share one client.
export default defineConfig(({ mode }) => {
	if (mode !== 'cloudflare-preview' && mode !== 'cloudflare-closed-preview') {
		throw new Error('Use an explicit Cloudflare preview mode');
	}
	const closed = mode === 'cloudflare-closed-preview' ? closedPreviewSettings(process.env) : null;
	return {
		worker: {
			name: 'fortemate-choice-preview',
			compatibilityDate: '2026-11-14',
			entrypoint: './hosting/worker.ts',
			workersDev: false,
			previewUrls: false,
			domains: closed ? [new URL(closed.origin).hostname] : [],
			env: closed
				? {
						ASSETS: bindings.assets(),
						PRIVATE_API: bindings.vpcService({ id: closed.serviceId }),
						PREVIEW_ORIGIN: bindings.text(closed.origin),
					}
				: { ASSETS: bindings.assets() },
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
