import { describe, expect, it } from 'vitest';
import { previewOrigin } from './preview-origin';

describe('isolated preview API origins', () => {
	it.each(['http://127.0.0.1:8081', 'https://choice-preview-api.example.test'])(
		'rejects password-only user info at %s',
		(origin) => {
			const url = new URL(origin);
			// Synthetic URL metadata tests password rejection independently of username rejection.
			url.password = origin;
			expect(() => previewOrigin(url.href)).toThrow();
		},
	);
	it.each([
		['http://127.0.0.1:8081', 'http://127.0.0.1:8081'],
		['http://localhost:8081/', 'http://localhost:8081'],
		['https://localhost:8081', 'https://localhost:8081'],
		['http://[::1]:8081', 'http://[::1]:8081'],
		['https://127.0.0.1:8081', 'https://127.0.0.1:8081'],
		['https://choice-preview-api.example.test/', 'https://choice-preview-api.example.test'],
		['https://CHOICE-PREVIEW-API.example.test:443', 'https://choice-preview-api.example.test'],
	])('accepts and normalizes %s', (input, expected) => {
		expect(previewOrigin(input)).toBe(expected);
	});

	it.each([
		'',
		'not a URL',
		'/relative',
		'https://api.example.test',
		'https://www.example.test',
		'https://preview-choice-api.example.test',
		'https://example.test/choice-preview-api',
		'http://choice-preview-api.example.test',
		'ws://127.0.0.1:8081',
		'wss://choice-preview-api.example.test',
		'ftp://localhost:8081',
		'http://localhost.example.test:8081',
		'http://127.0.0.2:8081',
		'http://127.0.0.1:8081/api',
		'https://choice-preview-api.example.test/api',
		'http://127.0.0.1:8081?example=fixture',
		'http://127.0.0.1:8081#fixture',
		'https://choice-preview-api.example.test?example=fixture',
		'https://choice-preview-api.example.test#fixture',
		'http://example@localhost:8081',
	])('rejects %s instead of choosing a fallback API', (input) => {
		expect(() => previewOrigin(input)).toThrow();
	});
});
