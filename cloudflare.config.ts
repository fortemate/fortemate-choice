import { bindings, defineConfig } from 'cf/config';
import { deploymentSettings } from './hosting/deployment-settings.ts';

// Release and preview are explicit targets; neither can replace the other implicitly.
export default defineConfig(({ mode }) => {
	const { workerName, privateApi } = deploymentSettings(mode, process.env);
	return {
		worker: {
			name: workerName,
			compatibilityDate: '2026-11-14',
			entrypoint: './hosting/worker.ts',
			workersDev: false,
			previewUrls: false,
			domains: privateApi ? [new URL(privateApi.origin).hostname] : [],
			env: privateApi
				? {
						ASSETS: bindings.assets(),
						PRIVATE_API: bindings.vpcService({ id: privateApi.serviceId }),
						PREVIEW_ORIGIN: bindings.text(privateApi.origin),
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
