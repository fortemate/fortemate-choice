import { fileURLToPath } from 'node:url';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { svelte, vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [
		paraglideVitePlugin({
			project: './project.inlang',
			outdir: './src/lib/paraglide',
			strategy: ['preferredLanguage', 'baseLocale'],
		}),
		svelte({ configFile: false, preprocess: vitePreprocess() }),
		svelteTesting(),
	],
	resolve: { alias: { '#lib': fileURLToPath(new URL('./src/lib', import.meta.url)) } },
	test: {
		environment: 'jsdom',
		include: ['src/**/*.test.ts', 'eslint-local/**/*.test.ts'],
		setupFiles: ['./vitest-setup.ts'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json-summary', 'lcov'],
			exclude: [
				'**/*.test.ts',
				'**/*.config.*',
				'vitest-setup.ts',
				'src/lib/paraglide/**',
				'src/laboratory/test-support/**',
				'dist-laboratory/**',
			],
		},
	},
});
