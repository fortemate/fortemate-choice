import { describe, expect, it } from 'vitest';
import { releaseSettings } from './release-settings';

const fixture = {
	CHOICE_RELEASE_ORIGIN: 'https://choice.example.test',
	CHOICE_RELEASE_VPC_SERVICE_ID: '01234567-89ab-cdef-0123-456789abcdef',
};

describe('release deployment coordinates', () => {
	it.each([
		'https://choice.example.test',
		'https://choice.example.test/',
		'https://choice.example.test:443',
	])('normalizes the release origin %s', (origin) => {
		expect(releaseSettings({ ...fixture, CHOICE_RELEASE_ORIGIN: origin })).toEqual({
			origin: fixture.CHOICE_RELEASE_ORIGIN,
			serviceId: fixture.CHOICE_RELEASE_VPC_SERVICE_ID,
		});
	});

	it.each([
		'',
		'http://choice.example.test',
		'https://choice-preview-web.example.test',
		'https://other.example.test',
		'https://choice.test',
		'https://localhost',
		'https://127.0.0.1',
		'https://[::1]',
		'https://choice.host.local',
		'https://choice.host.localhost',
		'https://choice.host.internal',
		'https://choice.127.0.0.1',
		'https://choice.example.test:9443',
		'https://choice.example.test/path',
		'https://choice.example.test/?fixture=1',
		'https://choice.example.test/?',
		'https://choice.example.test/#fixture',
		'https://choice.example.test/#',
		' https://choice.example.test',
	])('rejects %s instead of selecting a different API', (origin) => {
		expect(() => releaseSettings({ ...fixture, CHOICE_RELEASE_ORIGIN: origin })).toThrow();
	});

	it.each([undefined, '', 'not-a-service', '01234567-89ab-cdef-0123-456789abcdef/extra'])(
		'rejects missing or malformed private service %s',
		(serviceId) => {
			expect(() =>
				releaseSettings({ ...fixture, CHOICE_RELEASE_VPC_SERVICE_ID: serviceId }),
			).toThrow();
		},
	);

	it('rejects embedded release credentials', () => {
		for (const includePassword of [false, true]) {
			const origin = new URL(fixture.CHOICE_RELEASE_ORIGIN);
			origin.username = 'fixture-user';
			if (includePassword) origin.password = ['fixture', 'value'].join('-');
			expect(() => releaseSettings({ ...fixture, CHOICE_RELEASE_ORIGIN: origin.href })).toThrow();
		}
	});

	it('never substitutes preview coordinates for missing release settings', () => {
		expect(() =>
			releaseSettings({
				CHOICE_PREVIEW_API_URL: 'https://choice-preview-web.example.test',
				CHOICE_PREVIEW_VPC_SERVICE_ID: fixture.CHOICE_RELEASE_VPC_SERVICE_ID,
			}),
		).toThrow();
	});
});
