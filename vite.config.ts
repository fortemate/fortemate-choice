import { defineConfig } from 'vite';
import { laboratoryConfig } from './vite.laboratory.config';
import { hostingModes } from './hosting/deployment-settings';

// Keep the ordinary artifact intact; Cloudflare's CLI selects the isolated mode explicitly.
export default defineConfig(async (context) => {
	if (hostingModes.includes(context.mode)) {
		const { hostingConfig } = await import('./vite.hosting.config');
		return hostingConfig(context);
	}
	return laboratoryConfig(context);
});
