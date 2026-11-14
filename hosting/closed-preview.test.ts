import { describe, expect, it } from 'vitest';
import { closedPreviewSettings } from './closed-preview';

const fixture = {
	CHOICE_PREVIEW_API_URL: 'https://choice-preview-web.example.test',
	CHOICE_PREVIEW_VPC_SERVICE_ID: '01234567-89ab-cdef-0123-456789abcdef',
};

describe('closed preview deployment coordinates', () => {
	it('requires explicit private service and dedicated HTTPS origin', () => {
		expect(closedPreviewSettings(fixture)).toEqual({
			origin: fixture.CHOICE_PREVIEW_API_URL,
			serviceId: fixture.CHOICE_PREVIEW_VPC_SERVICE_ID,
		});
	});
	it.each([
		'',
		'http://127.0.0.1:8081',
		'https://localhost:9443',
		'https://api.example.test',
		'http://choice-preview-web.example.test',
	])('refuses %s as a closed origin', (origin) => {
		expect(() => closedPreviewSettings({ ...fixture, CHOICE_PREVIEW_API_URL: origin })).toThrow();
	});
	it.each(['', 'not-a-service', '1234', '01234567-89ab-cdef-0123-456789abcdef/extra'])(
		'refuses missing or malformed private service %s',
		(serviceId) => {
			expect(() =>
				closedPreviewSettings({ ...fixture, CHOICE_PREVIEW_VPC_SERVICE_ID: serviceId }),
			).toThrow();
		},
	);
});
