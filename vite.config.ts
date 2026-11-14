import { defineConfig } from 'vite';
import { laboratoryConfig } from './vite.laboratory.config';

// Keep the ordinary artifact intact; Cloudflare's CLI selects the isolated mode explicitly.
export default defineConfig(async (context) => {
	if (['cloudflare-preview', 'cloudflare-closed-preview'].includes(context.mode)) {
		const { hostingConfig } = await import('./vite.hosting.config');
		return hostingConfig(context);
	}
	return laboratoryConfig(context);
});
