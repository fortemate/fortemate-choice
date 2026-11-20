import { describe, expect, it } from 'vitest';
import { deploymentSettings } from './deployment-settings';

const env = {
	CHOICE_RELEASE_ORIGIN: 'https://choice.example.test',
	CHOICE_RELEASE_VPC_SERVICE_ID: '01234567-89ab-cdef-0123-456789abcdef',
	CHOICE_PREVIEW_API_URL: 'https://choice-preview-web.example.test',
	CHOICE_PREVIEW_VPC_SERVICE_ID: 'fedcba98-7654-3210-fedc-ba9876543210',
};

describe('explicit hosting target selection', () => {
	it('keeps local asset verification independent of remote service coordinates', () => {
		expect(deploymentSettings('cloudflare-preview', {})).toEqual({
			workerName: 'fortemate-choice-preview',
			privateApi: null,
		});
	});

	it('keeps the closed preview on its own Worker and private API', () => {
		expect(deploymentSettings('cloudflare-closed-preview', env)).toEqual({
			workerName: 'fortemate-choice-preview',
			privateApi: {
				origin: env.CHOICE_PREVIEW_API_URL,
				serviceId: env.CHOICE_PREVIEW_VPC_SERVICE_ID,
			},
		});
	});

	it('selects a different Worker and release coordinates even when both environments are present', () => {
		expect(deploymentSettings('cloudflare-release', env)).toEqual({
			workerName: 'fortemate-choice',
			privateApi: {
				origin: env.CHOICE_RELEASE_ORIGIN,
				serviceId: env.CHOICE_RELEASE_VPC_SERVICE_ID,
			},
		});
	});

	it.each([undefined, '', 'production', 'cloudflare', 'cloudflare-releas'])(
		'refuses implicit or misspelled provider mode %s',
		(mode) =>
			expect(() => deploymentSettings(mode, env)).toThrow(/explicit Cloudflare hosting mode/),
	);

	it('does not accept preview-only environment variables for a release build', () => {
		expect(() =>
			deploymentSettings('cloudflare-release', {
				CHOICE_PREVIEW_API_URL: env.CHOICE_PREVIEW_API_URL,
				CHOICE_PREVIEW_VPC_SERVICE_ID: env.CHOICE_PREVIEW_VPC_SERVICE_ID,
			}),
		).toThrow();
	});
});
