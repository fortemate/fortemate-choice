import { fileURLToPath } from 'node:url';
import { cloudflare } from '@cloudflare/vite-plugin';
import { loadEnv, type ConfigEnv, type Plugin } from 'vite';
import { laboratoryConfig } from './vite.laboratory.config';
import { previewOrigin } from './hosting/preview-origin';

const repoRoot = fileURLToPath(new URL('./', import.meta.url));

function hostingFiles(): Plugin {
	return {
		name: 'choice-preview-files',
		enforce: 'post',
		applyToEnvironment: (environment) => environment.name === 'client',
		transformIndexHtml: {
			order: 'pre',
			handler: (html) => html.replace('src="/main.ts"', 'src="/laboratory/main.ts"'),
		},
		generateBundle(_options, bundle) {
			const entry = bundle['laboratory/index.html'];
			if (entry?.type === 'asset') {
				this.emitFile({ type: 'asset', fileName: 'index.html', source: entry.source });
				delete bundle['laboratory/index.html'];
			}
			// Cloudflare does not support the legacy 200 rewrite. The Worker limits SPA routes.
			delete bundle._redirects;
			const headers = bundle._headers;
			if (headers?.type !== 'asset') throw new Error('Missing client security headers');
			headers.source = String(headers.source) + '  Cache-Control: no-store\n';
		},
	};
}

export function hostingConfig(context: ConfigEnv) {
	const env = loadEnv(context.mode, repoRoot, 'CHOICE_PREVIEW_');
	const apiOrigin = previewOrigin(env.CHOICE_PREVIEW_API_URL ?? '');
	const client = laboratoryConfig(context, apiOrigin);
	return {
		...client,
		root: repoRoot,
		plugins: [
			...client.plugins,
			hostingFiles(),
			cloudflare({ inspectorPort: false, remoteBindings: false, types: { includeRuntime: false } }),
		],
		build: {
			...client.build,
			outDir: fileURLToPath(new URL('./dist-hosting', import.meta.url)),
			rolldownOptions: {
				input: { index: fileURLToPath(new URL('./laboratory/index.html', import.meta.url)) },
			},
		},
		server: { host: '127.0.0.1', port: 8787, strictPort: true },
		preview: { host: '127.0.0.1', port: 8787, strictPort: true, cors: false },
	};
}
