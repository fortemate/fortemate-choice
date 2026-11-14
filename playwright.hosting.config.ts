/** Runs the Cloudflare native preview and the same isolated game fixtures as the ordinary build. */
import { defineConfig, devices } from '@playwright/test';

const APP_ORIGIN = 'http://127.0.0.1:8787';
const API_ORIGIN = 'http://127.0.0.1:8081';
process.env.CHOICE_TEST_APP_ORIGIN = APP_ORIGIN;

export default defineConfig({
	testDir: 'e2e',
	outputDir: 'test-results/hosting',
	testMatch: ['hosting/**/*.spec.ts', 'laboratory/laboratory.smoke.spec.ts'],
	retries: 0,
	timeout: 60_000,
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? [['github'], ['list']] : [['list']],
	use: { baseURL: APP_ORIGIN, trace: 'retain-on-failure' },
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'npm run preview:hosting',
		url: APP_ORIGIN,
		reuseExistingServer: false,
		timeout: 60_000,
		env: { CHOICE_PREVIEW_API_URL: API_ORIGIN },
	},
});
