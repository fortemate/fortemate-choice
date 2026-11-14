/** Shared disposable room fixtures for the TLS gateway and native hosting rehearsals. */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { API_ORIGIN, validateFrontendOrigin } from './configuration.mjs';

export const gameRequest = () => ({
	white: randomUUID(),
	black: randomUUID(),
	timeControl: { Unlimited: {} },
	variant: { id: 'choice-2x2d6', revision: 1 },
	labProtocolVersion: 1,
	rated: false,
});

export async function incompleteFixture({ env, browser, appOrigin, seed }) {
	validateFrontendOrigin(appOrigin);
	await env.restart({ admission: true, join: 2 });
	const response = await env.request('/games', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: gameRequest(),
	});
	assert.equal(response.status, 201);
	const room = response.json();
	const context = await browser.newContext({ ignoreHTTPSErrors: true });
	try {
		const page = await context.newPage();
		await page.goto(appOrigin);
		await page.evaluate(
			async ({ room, api, seed }) => {
				await new Promise((done, reject) => {
					const url = new URL(`/games/${room.gameId}/ws`, api);
					url.protocol = 'wss:';
					const socket = new WebSocket(url);
					const timer = setTimeout(() => {
						socket.close();
						reject(new Error('Incomplete fixture timed out'));
					}, 12000);
					socket.onopen = () =>
						socket.send(
							JSON.stringify({
								LabAuthenticate: {
									token: room.tokens.find((t) => t.seat === 'White').token,
									guest: crypto.randomUUID(),
								},
							}),
						);
					socket.onmessage = (message) => {
						const event = JSON.parse(message.data);
						if (event.LabAuthenticated) socket.send(JSON.stringify({ SubmitSeed: { seed } }));
						if (event.GameEnded) {
							clearTimeout(timer);
							socket.close();
							done();
						}
					};
				});
			},
			{ room, api: API_ORIGIN, seed },
		);
	} finally {
		await context.close();
	}
	const record = (await env.request(`/games/${room.gameId}/transcript`)).json();
	assert.equal(record.completeness, 'incomplete');
	assert.equal(record.fairness, null);
	await env.restart({ admission: true });
	return room;
}
