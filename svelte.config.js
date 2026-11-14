import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

// Type checking must not load the runtime build's required API-origin configuration.
export default { preprocess: vitePreprocess({ style: false }) };
