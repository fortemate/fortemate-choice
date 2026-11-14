/**
 * Browser acceptance for the built standalone laboratory. The runner drives two real browser
 * contexts through the public UI and public read endpoints; capability links, seat tokens, and
 * raw socket frames stay in memory and never enter findings or screenshots.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const TIMEOUT = 10_000;
const PHASES = [
	'AwaitingFirstRoll',
	'AwaitingSecondRoll',
	'AwaitingPairChoice',
	'PlayingSelectedPair',
];

export function isOrdinaryApiPath(pathname) {
	return (
		/^\/(?:lobby|auth|ingest|ratings?|training|profile)(?:\/|$)/.test(pathname) ||
		/^\/api\/(?:games|ratings?|training|profile)(?:\/|$)/.test(pathname)
	);
}

function safeError(error) {
	const message = error instanceof Error ? error.message : String(error);
	return message
		.replace(/https?:\/\/[^\s)]+/g, '[url]')
		.replace(/[A-Za-z0-9_-]{32,}/g, '[redacted]')
		.slice(0, 240);
}

function finding(scenario, passed, details = '') {
	return { scenario, status: passed ? 'PASS' : 'FAIL', details: String(details).slice(0, 240) };
}

async function waitForState(request, apiOrigin, gameId, predicate, timeout = TIMEOUT) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const response = await request.get(new URL(`/games/${gameId}`, apiOrigin).toString(), {
			timeout: TIMEOUT,
		});
		if (response.ok()) {
			const body = await response.json();
			if (predicate(body)) return body;
		}
		await new Promise((resolve) => setTimeout(resolve, 150));
	}
	throw new Error('Timed out waiting for the expected public game state');
}

function publicState(state) {
	const turn = state?.lab?.turn;
	return {
		phase: turn?.phase,
		offers: Array.isArray(turn?.offers) ? turn.offers.map((pair) => [...pair]) : [],
		selectedPairIndex: turn?.selectedPairIndex ?? null,
		activeSeat: state.activeSeat,
		variant: state?.lab?.variant ?? state?.variant ?? null,
		version: Number.isSafeInteger(state?.version) ? state.version : null,
	};
}

function sameTurn(a, b) {
	return (
		a.phase === b.phase &&
		a.activeSeat === b.activeSeat &&
		JSON.stringify(a.offers) === JSON.stringify(b.offers) &&
		a.selectedPairIndex === b.selectedPairIndex &&
		JSON.stringify(a.variant) === JSON.stringify(b.variant)
	);
}

function legalPath(tree) {
	if (!tree || typeof tree !== 'object') return [];
	const result = [];
	let node = tree;
	while (node && Object.keys(node).length && result.length < 2) {
		const move = Object.keys(node).sort((left, right) =>
			Buffer.compare(Buffer.from(left), Buffer.from(right)),
		)[0];
		result.push(move);
		node = node[move];
	}
	return result;
}

async function publicSnapshot(request, apiOrigin, gameId) {
	const response = await request.get(new URL(`/games/${gameId}`, apiOrigin).toString(), {
		timeout: TIMEOUT,
	});
	assert.equal(response.status(), 200, 'public state endpoint should return 200');
	return await response.json();
}

function clockValue(clocks, color) {
	const value = clocks?.[color] ?? clocks?.[color === 'white' ? 'White' : 'Black'];
	return Number.isFinite(value) ? value : null;
}

function checkStoppedClocks(before, after, message) {
	for (const color of ['white', 'black']) {
		const saved = clockValue(before, color);
		const restored = clockValue(after, color);
		if (saved !== null && restored !== null) assert.ok(Math.abs(restored - saved) <= 500, message);
	}
}

async function stageAction(page, phase) {
	if (phase === 'AwaitingFirstRoll' || phase === 'AwaitingSecondRoll') {
		const label = phase === 'AwaitingFirstRoll' ? /^roll dice$/i : /^finish roll$/i;
		const action = page.getByRole('button', { name: label });
		await action.waitFor({ state: 'visible', timeout: TIMEOUT });
		await action.click({ timeout: TIMEOUT });
		return;
	}
	if (phase === 'AwaitingPairChoice') {
		const cards = page.locator('.lab-pair-card:not(:disabled)');
		let card = cards.first();
		let preferred = null;
		let anyPlayable = null;
		const texts = await cards.allInnerTexts();
		for (const [index, text] of texts.entries()) {
			const candidate = cards.nth(index);
			if (/no legal moves/i.test(text)) continue;
			anyPlayable ??= candidate;
			if (/pawn|knight/i.test(text)) preferred ??= candidate;
		}
		card = preferred ?? anyPlayable ?? card;
		await card.waitFor({ state: 'visible', timeout: TIMEOUT });
		await card.tap({ timeout: TIMEOUT });
		assert.equal(await page.getByRole('button', { name: /confirm pair/i }).count(), 0);
		return anyPlayable !== null;
	}
	if (phase === 'PlayingSelectedPair') return;
	throw new Error('Unsupported phase action');
}

async function chooseAndSubmitMove(page, request, apiOrigin, gameId) {
	assert.equal(await page.getByRole('button', { name: /^submit turn$/i }).count(), 0);
	assert.equal(await page.getByRole('button', { name: /^undo$/i }).count(), 0);
	const response = await request.get(new URL(`/games/${gameId}/moves`, apiOrigin).toString(), {
		timeout: TIMEOUT,
	});
	assert.equal(response.status(), 200, 'public legal-moves endpoint should return 200');
	const body = await response.json();
	const moves = legalPath(body.legalMoves);
	assert.ok(moves.length, 'selected pair should have a legal move');
	for (const move of moves) {
		const from = page.getByRole('gridcell', {
			name: new RegExp(String.raw`^${move.slice(0, 2)}\b`, 'i'),
		});
		const to = page.getByRole('gridcell', {
			name: new RegExp(String.raw`^${move.slice(2, 4)}\b`, 'i'),
		});
		await from.click({ timeout: TIMEOUT });
		await to.click({ timeout: TIMEOUT });
		if (move.length === 5) await page.getByRole('button', { name: /queen/i }).click();
	}
	return moves.length;
}

async function checkLayout(page, outputDir, label, width, height, options = {}) {
	await page.setViewportSize({ width, height });
	await page.emulateMedia({ reducedMotion: options.reducedMotion ? 'reduce' : 'no-preference' });
	await page.waitForTimeout(120);
	const metrics = await page.evaluate(() => {
		const primary = [...document.querySelectorAll('.lab-primary')].find((el) => {
			const rect = el.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		});
		const rect = primary?.getBoundingClientRect();
		const board = document.querySelector('.lab-play-board')?.getBoundingClientRect();
		const layout = document.querySelector('.lab-game-grid')?.getBoundingClientRect();
		return {
			viewport: window.innerWidth,
			document: document.documentElement.scrollWidth,
			primaryHeight: rect ? rect.height : null,
			primaryVisible: !!rect && rect.bottom <= window.innerHeight && rect.top >= 0,
			boardWidth: board?.width ?? null,
			availableWidth: layout?.width ?? null,
		};
	});
	assert.ok(metrics.document <= metrics.viewport, 'page should not overflow horizontally');
	if (width <= 430 && metrics.boardWidth !== null) {
		assert.ok(
			metrics.boardWidth >= metrics.availableWidth - 2,
			'portrait mobile board should use the available content width',
		);
	}
	if (width === 390 && height === 844 && metrics.primaryHeight !== null) {
		assert.ok(metrics.primaryHeight >= 44, 'primary action should have a 44px touch target');
		if (!metrics.primaryVisible) {
			await page.locator('.lab-primary:visible').first().scrollIntoViewIfNeeded();
		}
		const visible = await page
			.locator('.lab-primary:visible')
			.first()
			.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= window.innerHeight;
			});
		assert.ok(
			visible,
			'primary confirmation should be reachable and visible on a 390x844 viewport',
		);
	}
	const file = path.join(outputDir, `${label}-${width}x${height}.png`);
	await page.screenshot({ path: file, fullPage: true, animations: 'disabled', timeout: TIMEOUT });
	return {
		scenario: `layout-${label}-${width}x${height}`,
		status: 'PASS',
		details: 'no horizontal overflow',
	};
}

async function finishRollWhenReady(page, apiOrigin, gameId, version) {
	const deadline = Date.now() + TIMEOUT;
	while (Date.now() < deadline) {
		if ((await publicSnapshot(page.request, apiOrigin, gameId)).version > version) return;
		// A one-click roll can finish while the API snapshot or UI catches up. Click only an
		// available recovery control atomically; never leave a locator waiting on a later turn.
		const clicked = await page.evaluate(() => {
			const action = [...document.querySelectorAll('button')].find((button) => {
				const accessible = button.cloneNode(true);
				accessible.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
				const label = (button.getAttribute('aria-label') ?? accessible.textContent ?? '')
					.replace(/\s+/g, ' ')
					.trim();
				const rect = button.getBoundingClientRect();
				return (
					/^finish roll$/i.test(label) &&
					!button.matches(':disabled') &&
					button.getAttribute('aria-disabled') !== 'true' &&
					rect.width > 0 &&
					rect.height > 0 &&
					getComputedStyle(button).visibility === 'visible'
				);
			});
			if (!action) return false;
			action.click();
			return true;
		});
		if (clicked) return;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	throw new Error('Timed out waiting for interrupted-roll recovery control');
}

async function advanceToPhase({ phase, hostPage, friendPage, apiOrigin, gameId }) {
	const targetIndex = PHASES.indexOf(phase);
	assert.ok(targetIndex >= 0, 'unsupported target phase');
	let advances = 0;
	while (true) {
		const turnState = await publicSnapshot(hostPage.request, apiOrigin, gameId);
		const currentPhase = turnState.lab.turn.phase;
		const currentIndex = PHASES.indexOf(currentPhase);
		assert.ok(currentIndex >= 0, 'unsupported current phase');
		if (currentIndex >= targetIndex) return;
		assert.ok(advances++ < 20, 'could not reach a playable pair after repeated server rolls');
		const activePage = turnState.activeSeat === 'White' ? hostPage : friendPage;
		if (currentPhase === 'AwaitingSecondRoll')
			await finishRollWhenReady(activePage, apiOrigin, gameId, turnState.version);
		else await stageAction(activePage, currentPhase);
		// Unplayable pairs can pass back into the same phase on the next turn.
		await waitForState(
			activePage.request,
			apiOrigin,
			gameId,
			(state) => state?.version > turnState.version,
		);
	}
}

async function checkOfflineControls(activePage, phase) {
	if (phase === 'PlayingSelectedPair') {
		assert.equal(
			await activePage.getByRole('gridcell').first().getAttribute('aria-disabled'),
			'true',
		);
		assert.equal(await activePage.getByRole('button', { name: /^submit turn$/i }).count(), 0);
		assert.equal(await activePage.getByRole('button', { name: /^undo$/i }).count(), 0);
	} else if (phase === 'AwaitingPairChoice') {
		const actionable = activePage.locator('.lab-pair-card').first();
		assert.equal(
			await actionable.isDisabled(),
			true,
			'pair selection should disable while offline',
		);
	} else {
		const actionable = activePage.locator('[data-stage-action]').first();
		assert.equal(
			await actionable.isDisabled(),
			true,
			'gameplay action should disable while offline',
		);
	}
}

function checkRestoredClocks(recovered, restartResult) {
	const elapsedSinceRestore = Math.max(0, performance.now() - restartResult.sampledAt);
	for (const color of ['white', 'black']) {
		const restoredAtRestart = clockValue(restartResult.restoredClocks, color);
		const observed = clockValue(recovered.clocks, color);
		assert.ok(
			restoredAtRestart !== null && observed !== null,
			'clock samples should contain both seats',
		);
		const activeColor = String(restartResult.activeSeat).toLowerCase() === color;
		const expected = Math.max(0, restoredAtRestart - (activeColor ? elapsedSinceRestore : 0));
		assert.ok(
			Math.abs(observed - expected) <= 500,
			`recovered ${color} clock should continue from restart baseline within 500ms`,
		);
	}
}

async function recoverPhase({
	phase,
	hostPage,
	friendPage,
	hostContext,
	friendContext,
	apiOrigin,
	gameId,
	restart,
	disconnect,
	interception,
	commandCounts,
	findings,
}) {
	interception.holdSecondRoll = phase === 'AwaitingSecondRoll';
	const heldBefore = interception.heldSecondRolls;
	await advanceToPhase({ phase, hostPage, friendPage, apiOrigin, gameId });
	const before = await waitForState(
		hostPage.request,
		apiOrigin,
		gameId,
		(state) => state?.lab?.turn?.phase === phase,
	);
	const beforeSafe = publicState(before);
	const activePage = before.activeSeat === 'White' ? hostPage : friendPage;
	if (interception.holdSecondRoll) {
		const deadline = Date.now() + TIMEOUT;
		while (interception.heldSecondRolls === heldBefore && Date.now() < deadline)
			await new Promise((resolve) => setTimeout(resolve, 50));
		assert.equal(
			interception.heldSecondRolls,
			heldBefore + 1,
			'one second-roll command should be interrupted',
		);
		assert.equal(
			await activePage.locator('.lab-pair-card').count(),
			0,
			'partial offers should remain hidden while the second roll is interrupted',
		);
	}
	const commandCount = commandCounts.get(activePage) ?? 0;
	await hostContext.setOffline(true);
	await friendContext.setOffline(true);
	await disconnect();
	await activePage.locator('.lab-game-notice[role="status"]').waitFor({
		state: 'visible',
		timeout: TIMEOUT,
	});
	await checkOfflineControls(activePage, phase);
	const restartResult = await restart(gameId);
	interception.holdSecondRoll = false;
	assert.ok(
		restartResult?.restoredClocks && Number.isFinite(restartResult.sampledAt),
		'restart hook should return the restored clock baseline and sample time',
	);
	await hostContext.setOffline(false);
	await friendContext.setOffline(false);
	await hostPage.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
	await friendPage.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
	const recovered = await waitForState(
		hostPage.request,
		apiOrigin,
		gameId,
		(state) => state?.lab?.turn?.phase === phase,
	);
	const afterSafe = publicState(recovered);
	assert.ok(recovered.clocks, 'timed recovery should expose both public clocks');
	checkRestoredClocks(recovered, restartResult);
	assert.ok(
		sameTurn(beforeSafe, afterSafe),
		`public turn should be unchanged after offline/restart at ${phase}`,
	);
	await hostPage.getByRole('grid').waitFor({ state: 'visible', timeout: TIMEOUT });
	await activePage.waitForFunction(
		(isMovePhase) =>
			isMovePhase
				? document.activeElement?.getAttribute('role') === 'gridcell'
				: document.activeElement?.matches('[data-stage-action]:not(:disabled)') === true,
		phase === 'PlayingSelectedPair',
		{ timeout: TIMEOUT },
	);
	const beforeTabCount = commandCounts.get(activePage) ?? 0;
	await activePage.keyboard.press('Tab');
	assert.equal(
		await activePage.evaluate(() => document.activeElement === document.body),
		false,
		'Tab should move focus to an interactive control',
	);
	assert.equal(
		commandCounts.get(activePage) ?? 0,
		beforeTabCount,
		'Tab should not submit a game command',
	);
	assert.equal(
		commandCounts.get(activePage) ?? 0,
		commandCount,
		'recovery should not send an automatic gameplay command',
	);
	if (phase !== 'PlayingSelectedPair') {
		const actionable = activePage.locator('[data-stage-action]').first();
		await actionable.waitFor({ state: 'visible', timeout: TIMEOUT });
		assert.equal(
			await actionable.isDisabled(),
			false,
			'reconnected current seat should be able to act',
		);
	}
	findings.push(
		finding(
			`recover-${phase}`,
			true,
			'offers, selected pair, and variant retained; no automatic gameplay command',
		),
	);
	process.stdout.write(`[Laboratory Browser] PASS ${phase}\n`);
}

/**
 * Runs the built-lab browser acceptance journey. `restart` must restart only the isolated lab API
 * and resolve after its health check succeeds. Findings intentionally contain no game ids,
 * invitation URLs, seat tokens, socket frames, or request bodies.
 */
export async function runBrowserAcceptance({
	browser,
	appOrigin,
	apiOrigin,
	restart,
	disconnect,
	incompleteRoom,
	outputDir,
}) {
	const findings = [];
	const origins = new Set([new URL(appOrigin).origin, new URL(apiOrigin).origin]);
	await fs.mkdir(outputDir, { recursive: true });
	let hostContext;
	let friendContext;
	let incompleteContext;
	let hostPage;
	let friendPage;
	let incompletePage;
	let gameId;
	const commandCounts = new WeakMap();
	const pageErrorCounts = new WeakMap();
	const monitoredPages = new WeakSet();
	const interception = { holdSecondRoll: false, heldSecondRolls: 0 };
	const auditPage = async (page) => {
		if (monitoredPages.has(page)) return;
		monitoredPages.add(page);
		pageErrorCounts.set(page, 0);
		page.on('pageerror', () => pageErrorCounts.set(page, (pageErrorCounts.get(page) ?? 0) + 1));
		page.on('request', (request) => {
			try {
				const url = new URL(request.url());
				assert.ok(origins.has(url.origin), 'unexpected external network request');
				assert.equal(
					isOrdinaryApiPath(url.pathname),
					false,
					'laboratory should not call ordinary API, lobby, auth, or ingest routes',
				);
			} catch (error) {
				if (error instanceof assert.AssertionError) page.__labExternalRequest = true;
			}
		});
		await page.route('**/*', async (route) => {
			const url = new URL(route.request().url());
			const ordinaryApi = isOrdinaryApiPath(url.pathname);
			if (!origins.has(url.origin) || ordinaryApi) {
				page.__labExternalRequest = true;
				await route.abort();
			} else {
				await route.continue();
			}
		});
		await page.routeWebSocket('**/*', (socket) => {
			try {
				const socketUrl = new URL(socket.url());
				if (socketUrl.pathname.includes('/games/')) {
					assert.equal(socketUrl.search, '', 'laboratory WebSocket URL should have no query');
					assert.equal(socketUrl.hash, '', 'laboratory WebSocket URL should have no fragment');
				}
				socketUrl.protocol = socketUrl.protocol === 'wss:' ? 'https:' : 'http:';
				assert.ok(origins.has(socketUrl.origin), 'unexpected external websocket');
			} catch (error) {
				if (error instanceof assert.AssertionError) {
					page.__labExternalRequest = true;
					socket.close({ code: 1008, reason: 'Acceptance network boundary' });
					return;
				}
			}
			commandCounts.set(page, commandCounts.get(page) ?? 0);
			const server = socket.connectToServer();
			socket.onMessage((message) => {
				const raw = typeof message === 'string' ? message : '';
				if (
					raw.includes('LabCommand') ||
					raw.includes('SubmitTurn') ||
					raw.includes('RollFirst') ||
					raw.includes('RollSecond') ||
					raw.includes('ChoosePair')
				) {
					commandCounts.set(page, (commandCounts.get(page) ?? 0) + 1);
				}
				// Interrupt the one-click sequence only for the persisted first-pair checkpoint.
				// All other frames reach the real server unchanged; no capability is recorded.
				if (interception.holdSecondRoll && raw) {
					const frame = JSON.parse(raw);
					if (frame?.LabCommand?.action?.RollSecond) {
						interception.heldSecondRolls += 1;
						return;
					}
				}
				server.send(message);
			});
		});
	};

	try {
		hostContext = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			hasTouch: true,
		});
		friendContext = await browser.newContext({
			viewport: { width: 1440, height: 900 },
			hasTouch: true,
		});
		hostPage = await hostContext.newPage();
		friendPage = await friendContext.newPage();
		await auditPage(hostPage);
		await auditPage(friendPage);
		await Promise.all([
			hostPage.goto(appOrigin, { waitUntil: 'networkidle', timeout: TIMEOUT }),
			friendPage.goto(appOrigin, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }),
		]);
		await hostPage
			.getByRole('heading', { level: 1 })
			.first()
			.waitFor({ state: 'visible', timeout: TIMEOUT });
		const settings = hostPage.locator('.lab-time-grid');
		await settings.getByRole('button', { name: /10\s*\+\s*10/ }).click({ timeout: TIMEOUT });
		await hostPage
			.locator('.lab-color-grid')
			.getByRole('button', { name: /white/i })
			.click({ timeout: TIMEOUT });
		await hostPage.locator('form button[type="submit"]').click({ timeout: TIMEOUT });
		const invitation = hostPage.locator('#lab-invitation');
		await invitation.waitFor({ state: 'visible', timeout: TIMEOUT });
		const invitationUrl = await invitation.inputValue();
		const invite = new URL(invitationUrl);
		assert.equal(
			invite.origin,
			new URL(appOrigin).origin,
			'invitation should remain on the lab origin',
		);
		const invitationEvidence = await hostPage
			.locator('.lab-settings-line strong')
			.first()
			.textContent();
		assert.match(invitationEvidence ?? '', /10\s*\+\s*10/);
		const inviteGameId = /^\/invite\/([0-9a-f-]{36})$/i.exec(invite.pathname)?.[1];
		assert.ok(inviteGameId, 'invitation UI should expose a valid room route');
		await hostPage.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
		await hostPage.locator('#lab-invitation').waitFor({ state: 'visible', timeout: TIMEOUT });
		const waitingBefore = await waitForState(
			hostPage.request,
			apiOrigin,
			inviteGameId,
			(state) => state?.lab?.turn?.phase === 'AwaitingPlayers',
		);
		const waitingRestart = await restart(inviteGameId);
		const waitingAfter = await waitForState(
			hostPage.request,
			apiOrigin,
			inviteGameId,
			(state) => state?.lab?.turn?.phase === 'AwaitingPlayers',
		);
		assert.ok(sameTurn(publicState(waitingBefore), publicState(waitingAfter)));
		checkStoppedClocks(
			waitingRestart?.savedClocks,
			waitingAfter.clocks,
			'waiting-room clocks should remain stopped across restart',
		);
		if (waitingAfter.clocks) {
			await new Promise((resolve) => setTimeout(resolve, 1100));
			const waitingLater = await publicSnapshot(hostPage.request, apiOrigin, inviteGameId);
			checkStoppedClocks(
				waitingAfter.clocks,
				waitingLater.clocks,
				'AwaitingPlayers clocks should stay stopped',
			);
		}
		findings.push(
			finding(
				'recover-AwaitingPlayers',
				true,
				'waiting room survived API restart before the invited seat joined; no waiting clock ran',
			),
		);
		process.stdout.write('[Laboratory Browser] PASS AwaitingPlayers\n');
		await friendPage.goto(invitationUrl, { waitUntil: 'networkidle', timeout: TIMEOUT });
		await friendPage.getByRole('button', { name: /join as black/i }).click({ timeout: TIMEOUT });
		await hostPage.getByRole('link', { name: /open my board/i }).click({ timeout: TIMEOUT });
		await hostPage.getByRole('grid').waitFor({ state: 'visible', timeout: TIMEOUT });
		await friendPage.getByRole('grid').waitFor({ state: 'visible', timeout: TIMEOUT });
		assert.match(await hostPage.getByRole('grid').getAttribute('aria-label'), /white board/i);
		assert.match(await friendPage.getByRole('grid').getAttribute('aria-label'), /black board/i);
		const boardUrl = new URL(hostPage.url());
		const pathMatch = /^\/game\/([0-9a-f-]{36})$/i.exec(boardUrl.pathname);
		assert.ok(pathMatch, 'host board route should contain a valid game identifier');
		gameId = pathMatch[1];
		const ready = await waitForState(
			hostPage.request,
			apiOrigin,
			gameId,
			(state) => state?.lab?.turn?.phase === 'AwaitingFirstRoll',
		);
		assert.equal(
			ready.timeControl?.Fischer?.initialSeconds,
			600,
			'room should retain 10+10 time control',
		);
		assert.equal(
			ready.timeControl?.Fischer?.incrementSeconds,
			10,
			'room should retain 10+10 increment',
		);
		assert.ok(
			ready.lab?.variant?.id && Number.isInteger(ready.lab?.variant?.revision),
			'room should have a versioned variant',
		);
		findings.push(
			finding(
				'room-settings-and-ui-seat-grant',
				true,
				'10+10 settings and Black invitation seat confirmed',
			),
		);

		const desktopLayout = await checkLayout(hostPage, outputDir, 'desktop', 1440, 900);
		findings.push(desktopLayout);
		for (const [width, height] of [
			[320, 740],
			[390, 844],
			[844, 390],
		]) {
			findings.push(
				await checkLayout(hostPage, outputDir, 'host-board', width, height, {
					reducedMotion: width !== 1440,
				}),
			);
		}
		await hostPage.setViewportSize({ width: 1440, height: 900 });
		await hostPage.getByLabel(/appearance/i).selectOption('dark');
		assert.equal(
			await hostPage.locator('html').getAttribute('data-lab-theme'),
			'dark',
			'dark appearance should be applied',
		);
		await hostPage.getByLabel(/appearance/i).selectOption('light');
		assert.equal(
			await hostPage.locator('html').getAttribute('data-lab-theme'),
			'light',
			'light appearance should be applied',
		);
		findings.push(
			finding(
				'appearance-and-reduced-motion',
				true,
				'light/dark controls and reduced-motion layout exercised',
			),
		);

		// Move to each checkpoint through the actual UI. If both initial offers are unplayable, the
		// server passes that turn; continue through the friend's turns until a playable pair appears.
		for (const phase of PHASES) {
			await recoverPhase({
				phase,
				hostPage,
				friendPage,
				hostContext,
				friendContext,
				apiOrigin,
				gameId,
				restart,
				disconnect,
				interception,
				commandCounts,
				findings,
			});
		}

		const selectedState = await publicSnapshot(hostPage.request, apiOrigin, gameId);
		assert.equal(selectedState.lab.turn.phase, 'PlayingSelectedPair');
		const movePage = selectedState.activeSeat === 'White' ? hostPage : friendPage;
		const movesPlayed = await chooseAndSubmitMove(movePage, movePage.request, apiOrigin, gameId);
		const nextTurn = await waitForState(
			hostPage.request,
			apiOrigin,
			gameId,
			(state) =>
				state.version > selectedState.version && state.activeSeat !== selectedState.activeSeat,
		);
		findings.push(
			finding(
				'legal-move-through-ui',
				true,
				`automatically submitted a legal move sequence (${movesPlayed} micro-move${movesPlayed === 1 ? '' : 's'})`,
			),
		);
		const rollPage = nextTurn.activeSeat === 'White' ? hostPage : friendPage;
		const beforeRollCount = commandCounts.get(rollPage) ?? 0;
		await stageAction(rollPage, 'AwaitingFirstRoll');
		const rolled = await waitForState(
			hostPage.request,
			apiOrigin,
			gameId,
			(state) => state?.lab?.turn?.phase === 'AwaitingPairChoice',
		);
		assert.equal(
			rolled.lab.turn.offers.length,
			2,
			'one click should reveal both authoritative offers',
		);
		assert.equal(rolled.lab.turn.selectedPairIndex, null, 'the player must still choose the pair');
		assert.equal(
			commandCounts.get(rollPage),
			beforeRollCount + 2,
			'one click should send exactly the two existing roll commands',
		);
		await rollPage.locator('.lab-pair-card').nth(1).waitFor({ state: 'visible', timeout: TIMEOUT });
		findings.push(
			finding(
				'one-click-two-pairs',
				true,
				'one UI action revealed both pairs through two authoritative commands; no pair auto-selected',
			),
		);

		await hostPage.getByRole('button', { name: /resign/i }).click({ timeout: TIMEOUT });
		const confirm = hostPage.getByRole('group', { name: /confirm resign/i });
		await confirm.waitFor({ state: 'visible', timeout: TIMEOUT });
		const confirmButton = confirm.getByRole('button', { name: /confirm resign/i });
		await confirmButton.focus();
		await hostPage.keyboard.press('Enter');
		await waitForState(
			hostPage.request,
			apiOrigin,
			gameId,
			(state) => Boolean(state.status?.Ended),
			TIMEOUT,
		);
		const reviewButton = hostPage.getByRole('button', { name: /review/i });
		await reviewButton.waitFor({ state: 'visible', timeout: TIMEOUT });
		await reviewButton.click({ timeout: TIMEOUT });
		await hostPage
			.getByRole('heading', { name: /game record/i })
			.waitFor({ state: 'visible', timeout: TIMEOUT });
		const downloadPromise = hostPage.waitForEvent('download', { timeout: TIMEOUT });
		await hostPage
			.getByRole('button', { name: /download versioned record/i })
			.click({ timeout: TIMEOUT });
		const download = await downloadPromise;
		assert.match(
			download.suggestedFilename(),
			/^dicechess-choice-2x2d6-r1-schema1-[0-9a-f-]+\.json$/i,
		);
		const downloadedPath = await download.path();
		assert.ok(downloadedPath, 'public transcript download should be available');
		const transcript = JSON.parse(await fs.readFile(downloadedPath, 'utf8'));
		await fs.unlink(downloadedPath).catch(() => undefined);
		assert.equal(transcript.schemaVersion, 1);
		assert.ok(Array.isArray(transcript.turns));
		assert.ok(
			transcript.status?.Ended?.over?.termination &&
				transcript.status.Ended.over.termination !== 'Aborted',
		);
		assert.deepEqual(
			transcript.status.Ended.over,
			{
				result: { Win: { side: 'Black' } },
				termination: 'Resign',
			},
			'The White participant resigned through the UI',
		);
		await fs.writeFile(
			path.join(outputDir, 'terminal-record.json'),
			JSON.stringify(transcript, null, 2),
		);
		await fs.writeFile(
			path.join(outputDir, 'transcript-summary.json'),
			JSON.stringify(
				{
					schemaVersion: transcript.schemaVersion,
					completeness: transcript.completeness,
					termination: transcript.status.Ended.over.termination,
					turnCount: transcript.turns.length,
					variant: transcript.variant,
					rulesVersion: transcript.provenance.rulesVersion,
					fairnessIncluded: transcript.fairness !== null,
				},
				null,
				2,
			),
		);
		findings.push(
			finding(
				'finished-review-and-public-export',
				true,
				'review opened and schema 1 public transcript downloaded',
			),
		);

		const rematchButton = hostPage.getByRole('button', { name: /offer rematch|check rematch/i });
		await rematchButton.click({ timeout: TIMEOUT });
		const hostCheck = hostPage.getByRole('button', { name: /check rematch/i });
		await hostCheck.waitFor({ state: 'visible', timeout: TIMEOUT });
		await friendPage.reload({ waitUntil: 'networkidle', timeout: TIMEOUT });
		const friendRematch = friendPage.getByRole('button', { name: /offer rematch|check rematch/i });
		await friendRematch.waitFor({ state: 'visible', timeout: TIMEOUT });
		await friendRematch.click({ timeout: TIMEOUT });
		await friendPage.waitForURL(
			(url) => url.pathname.startsWith('/game/') && !url.pathname.endsWith(gameId),
			{ timeout: TIMEOUT },
		);
		await hostCheck.click({ timeout: TIMEOUT });
		await hostPage.waitForURL((url) => url.pathname === new URL(friendPage.url()).pathname, {
			timeout: TIMEOUT,
		});
		await hostPage.getByRole('grid').waitFor({ state: 'visible', timeout: TIMEOUT });
		await friendPage.getByRole('grid').waitFor({ state: 'visible', timeout: TIMEOUT });
		const hostRematchId = /^\/game\/([0-9a-f-]{36})$/i.exec(new URL(hostPage.url()).pathname)?.[1];
		const friendRematchId = /^\/game\/([0-9a-f-]{36})$/i.exec(
			new URL(friendPage.url()).pathname,
		)?.[1];
		assert.ok(
			hostRematchId && hostRematchId === friendRematchId && hostRematchId !== gameId,
			'both seats should enter the same new rematch',
		);
		const rematchState = await waitForState(
			hostPage.request,
			apiOrigin,
			hostRematchId,
			(state) => state?.lab?.turn?.phase === 'AwaitingFirstRoll',
		);
		assert.deepEqual(
			rematchState.lab.variant,
			ready.lab.variant,
			'rematch should preserve the variant revision',
		);
		assert.deepEqual(
			rematchState.timeControl,
			ready.timeControl,
			'rematch should preserve the time control',
		);
		assert.match(await hostPage.getByRole('grid').getAttribute('aria-label'), /black board/i);
		assert.match(await friendPage.getByRole('grid').getAttribute('aria-label'), /white board/i);
		findings.push(
			finding('mutual-rematch-consent', true, 'both seats entered the same new rematch room'),
		);

		assert.ok(
			incompleteRoom?.gameId && Array.isArray(incompleteRoom.tokens),
			'incomplete-room fixture should provide a room and seat capabilities',
		);
		assert.match(
			incompleteRoom.gameId,
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
		);
		const whiteCapability = incompleteRoom.tokens.find((candidate) => candidate?.seat === 'White');
		assert.ok(
			whiteCapability && typeof whiteCapability.token === 'string',
			'incomplete-room fixture should provide the White seat capability',
		);
		incompleteContext = await browser.newContext({
			viewport: { width: 1440, height: 900 },
		});
		incompletePage = await incompleteContext.newPage();
		await auditPage(incompletePage);
		const incompleteUrl = new URL(`/game/${incompleteRoom.gameId}`, appOrigin);
		incompleteUrl.hash = new URLSearchParams({
			token: whiteCapability.token,
			as: 'white',
		}).toString();
		await incompletePage.goto(incompleteUrl.toString(), {
			waitUntil: 'networkidle',
			timeout: TIMEOUT,
		});
		await incompletePage
			.getByRole('button', { name: /review game record/i })
			.waitFor({ state: 'visible', timeout: TIMEOUT });
		await incompletePage
			.getByRole('button', { name: /review game record/i })
			.click({ timeout: TIMEOUT });
		await incompletePage
			.getByRole('heading', { name: /game record/i })
			.waitFor({ state: 'visible', timeout: TIMEOUT });
		const incompleteDownloadPromise = incompletePage.waitForEvent('download', { timeout: TIMEOUT });
		await incompletePage
			.getByRole('button', { name: /download versioned record/i })
			.click({ timeout: TIMEOUT });
		const incompleteDownload = await incompleteDownloadPromise;
		const incompletePath = await incompleteDownload.path();
		assert.ok(incompletePath, 'incomplete public record download should be available');
		const incompleteRecord = JSON.parse(await fs.readFile(incompletePath, 'utf8'));
		await fs.unlink(incompletePath).catch(() => undefined);
		assert.equal(incompleteRecord.completeness, 'incomplete');
		assert.equal(incompleteRecord.status?.Ended?.over?.termination, 'Aborted');
		assert.equal(incompleteRecord.fairness, null);
		const incompleteReviewText = await incompletePage.locator('.lab-review').innerText();
		assert.doesNotMatch(
			incompleteReviewText,
			/(?:fairness verified|verification passed|fairness:\s*pass|verification:\s*pass)/i,
			'incomplete review should not claim verification passed',
		);
		await incompletePage.screenshot({
			path: path.join(outputDir, 'incomplete-record-review.png'),
			fullPage: true,
			animations: 'disabled',
			timeout: TIMEOUT,
		});
		await fs.writeFile(
			path.join(outputDir, 'incomplete-record.json'),
			JSON.stringify(incompleteRecord, null, 2),
		);
		findings.push(
			finding(
				'incomplete-record-review',
				true,
				'authorized White seat reviewed the public incomplete record; Aborted, no fairness proof, no verification-pass claim',
			),
		);
		process.stdout.write('[Laboratory Browser] PASS incomplete-record-review\n');

		const storageState = await hostPage.evaluate(async () => {
			const keys = Object.keys(localStorage);
			const sessionKeys = Object.keys(sessionStorage);
			const databases =
				typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
			return {
				localKeys: keys.map((key) => key.toLowerCase()),
				sessionKeys: sessionKeys.map((key) => key.toLowerCase()),
				databaseNames: databases.map((database) => String(database.name ?? '').toLowerCase()),
			};
		});
		assert.ok(
			storageState.localKeys.every((key) => key.startsWith('dicechess-laboratory-')),
			'localStorage should contain only laboratory-owned keys',
		);
		assert.ok(
			storageState.sessionKeys.every(
				(key) =>
					key.startsWith('dicechess-laboratory-room:') ||
					key.startsWith('dicechess-laboratory-seed:'),
			),
			'sessionStorage should contain only laboratory room capabilities and client seeds',
		);
		assert.equal(
			storageState.localKeys.some((key) => /outbox|history|localgames|game-record/.test(key)),
			false,
			'main-site outbox/history should not be persisted in localStorage',
		);
		assert.deepEqual(
			storageState.databaseNames,
			[],
			'laboratory should create no IndexedDB databases',
		);
		assert.equal(
			pageErrorCounts.get(hostPage) ?? 0,
			0,
			'host page should have no uncaught exceptions',
		);
		assert.equal(
			pageErrorCounts.get(friendPage) ?? 0,
			0,
			'friend page should have no uncaught exceptions',
		);
		assert.equal(
			pageErrorCounts.get(incompletePage) ?? 0,
			0,
			'incomplete record page should have no uncaught exceptions',
		);
		assert.equal(
			Boolean(
				hostPage.__labExternalRequest ||
				friendPage.__labExternalRequest ||
				incompletePage.__labExternalRequest,
			),
			false,
			'all browser requests should stay on configured origins',
		);
		findings.push(
			finding(
				'isolated-storage-and-network',
				true,
				'no main-site outbox/history storage found; requests stayed on the two configured origins',
			),
		);
	} catch (error) {
		findings.push(finding('browser-journey', false, safeError(error)));
	} finally {
		await Promise.allSettled([
			hostContext?.close(),
			friendContext?.close(),
			incompleteContext?.close(),
		]);
	}
	let terminalRecord = null;
	let incompleteRecord = null;
	try {
		terminalRecord = JSON.parse(
			await fs.readFile(path.join(outputDir, 'terminal-record.json'), 'utf8'),
		);
	} catch {
		// A missing file means the UI did not reach a public terminal record.
	}
	try {
		incompleteRecord = JSON.parse(
			await fs.readFile(path.join(outputDir, 'incomplete-record.json'), 'utf8'),
		);
	} catch {
		// A missing file means the fixture room did not reach public record review.
	}
	return { findings, terminalRecord, incompleteRecord };
}
