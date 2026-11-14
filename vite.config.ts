import { defineConfig } from 'vite';
import { laboratoryConfig } from './vite.laboratory.config';

// Keep the ordinary artifact intact; Cloudflare's CLI selects the isolated mode explicitly.
export default defineConfig(async (context) => {
	if (context.mode === 'cloudflare-preview') {
		const { hostingConfig } = await import('./vite.hosting.config');
		return hostingConfig(context);
	}
	return laboratoryConfig(context);
});
