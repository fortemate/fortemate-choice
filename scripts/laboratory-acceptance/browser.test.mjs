import test from 'node:test';
import assert from 'node:assert/strict';
import { isOrdinaryApiPath } from './browser.mjs';

test('browser boundary blocks ordinary API route segments, including their children', () => {
	for (const path of [
		'/lobby',
		'/auth',
		'/ingest',
		'/rating',
		'/ratings',
		'/training',
		'/profile',
		'/api/games',
		'/api/rating',
		'/api/ratings',
		'/api/training',
		'/api/profile',
	]) {
		assert.equal(isOrdinaryApiPath(path), true, path);
		assert.equal(isOrdinaryApiPath(path + '/child'), true, path);
	}
});

test('browser boundary preserves lab routes and does not confuse a prefix with a segment', () => {
	for (const path of [
		'/',
		'/games',
		'/games/example/moves',
		'/game/example',
		'/invite/example',
		'/record',
		'/assets/app.js',
		'/lobbyist',
		'/ratings-page',
		'/api/games-preview',
		'/api/gaming',
	]) {
		assert.equal(isOrdinaryApiPath(path), false, path);
	}
});
