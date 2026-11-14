import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DiceChess } from '@fortemate/dicechess-engine';
import {
	classicRoll,
	deterministicOffers,
	verifyGoldenVector,
	verifyTranscript,
} from './oracle.mjs';

const fixture = JSON.parse(
	readFileSync(new URL('./fairness-vectors.json', import.meta.url), 'utf8'),
);

test('retained real-service evidence keeps its digests, fairness, moves, and expected outcomes', () => {
	const evidence = new URL('./evidence/', import.meta.url);
	const checksums = readFileSync(new URL('SHA256SUMS', evidence), 'utf8').trim().split('\n');
	for (const line of checksums) {
		const [, digest, name] = line.match(/^([a-f0-9]{64}) {2}([a-zA-Z0-9.-]+)$/) ?? [];
		assert.ok(name, 'evidence checksum uses a plain local filename');
		assert.equal(
			createHash('sha256')
				.update(readFileSync(new URL(name, evidence)))
				.digest('hex'),
			digest,
			name,
		);
	}
	const read = (name) => JSON.parse(readFileSync(new URL(`${name}.json`, evidence), 'utf8'));
	const results = read('acceptance-results');
	assert.equal(results.status, 'PASS');
	assert.ok(results.scenarios.length >= 30);
	assert.ok(results.scenarios.every((scenario) => scenario.status === 'PASS'));
	const reviewResults = read('review-acceptance-results');
	assert.equal(reviewResults.status, 'PASS');
	assert.equal(reviewResults.scenarios.length, 30);
	assert.ok(reviewResults.scenarios.every((scenario) => scenario.status === 'PASS'));
	for (const name of [
		'equal-offers',
		'unplayable-over-playable',
		'both-unplayable',
		'maximum-consumption',
		'castling',
		'promotion',
		'protocol-rejections',
		'waiting-restart',
		'terminal-record',
		'selection-timeout',
		'king-capture',
	]) {
		const record = read(name);
		assert.equal(verifyTranscript(record).status, 'verified', name);
		assert.deepEqual(
			record.status.Ended.over,
			{
				result: { Win: { side: name === 'king-capture' ? 'White' : 'Black' } },
				termination:
					name === 'king-capture'
						? 'KingCaptured'
						: name === 'selection-timeout'
							? 'Timeout'
							: 'Resign',
			},
			name,
		);
		if (name === 'king-capture') {
			for (const [label, mutate] of [
				['missing termination', (bad) => delete bad.status.Ended.over.termination],
				['unsupported termination', (bad) => (bad.status.Ended.over.termination = 'Unknown')],
				[
					'unsupported laboratory DoubleDeclined termination',
					(bad) => (bad.status.Ended.over.termination = 'DoubleDeclined'),
				],
				['missing result', (bad) => delete bad.status.Ended.over.result],
				['draw for king capture', (bad) => (bad.status.Ended.over.result = { Draw: {} })],
				['win result for a draw reason', (bad) => (bad.status.Ended.over.termination = 'Draw')],
				['extra result discriminator', (bad) => (bad.status.Ended.over.result.Draw = {})],
				['extra win payload key', (bad) => (bad.status.Ended.over.result.Win.unexpected = true)],
				['missing terminal offers', (bad) => delete bad.currentTurn.offers],
				['empty terminal offers', (bad) => (bad.currentTurn.offers = [])],
				['missing terminal selection', (bad) => delete bad.currentTurn.selectedPairIndex],
				['null terminal selection', (bad) => (bad.currentTurn.selectedPairIndex = null)],
				[
					'other terminal selection',
					(bad) =>
						(bad.currentTurn.selectedPairIndex = bad.turns.at(-1).selectedPairIndex === 0 ? 1 : 0),
				],
			]) {
				const tampered = structuredClone(record);
				mutate(tampered);
				assert.equal(verifyTranscript(tampered).status, 'failed', label);
			}
		} else if (name === 'both-unplayable') {
			const noOutcome = structuredClone(record);
			delete noOutcome.status.Ended.over.result;
			delete noOutcome.status.Ended.over.termination;
			assert.deepEqual(noOutcome.status.Ended.over, {});
			assert.equal(verifyTranscript(noOutcome).status, 'failed');
		}
	}
	for (const name of ['missing-participant-incomplete', 'incomplete-record']) {
		const record = read(name);
		assert.equal(record.completeness, 'incomplete');
		assert.equal(record.fairness, null);
		assert.deepEqual(record.status.Ended.over, { result: { Draw: {} }, termination: 'Aborted' });
		assert.equal(verifyTranscript(record).status, 'not-verifiable');
	}
});

test('independent implementation matches every laboratory and classic golden vector', () => {
	assert.equal(fixture.algorithm, 'choice-2x2d6-hmac-sha256-v1');
	assert.ok(fixture.vectors.length > 0);
	for (const vector of fixture.vectors) {
		assert.equal(verifyGoldenVector(vector), true, vector.name);
		assert.deepEqual(
			deterministicOffers(
				vector.serverSeed,
				vector.clientSeeds.white,
				vector.clientSeeds.black,
				vector.turnNumber,
			),
			vector.offers,
			vector.name,
		);
		assert.deepEqual(
			classicRoll(
				vector.serverSeed,
				vector.clientSeeds.white,
				vector.clientSeeds.black,
				vector.turnNumber,
			),
			vector.classicDice,
			vector.name,
		);
	}
});

test('a complete transcript verifies commit, both offers, selected dice, and replayed FEN', () => {
	const vector = fixture.vectors.find(
		(candidate) => candidate.name === 'ascending-alice-bob-turn-0',
	);
	const initialDfen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
	let clientSeeds;
	let offers;
	let selectedPairIndex;
	let dice;
	let moves;
	let dfen;
	for (let candidate = 0; candidate < 1000 && !moves; candidate += 1) {
		clientSeeds = { white: `white-${candidate}`, black: `black-${candidate}` };
		offers = deterministicOffers(vector.serverSeed, clientSeeds.white, clientSeeds.black, 0);
		for (let pairIndex = 0; pairIndex < offers.length && !moves; pairIndex += 1) {
			const pair = offers[pairIndex];
			const letters = pair.map((die) => 'PNBRQK'[die - 1]).join('');
			const rolled = `${initialDfen} ${letters}`;
			let node = DiceChess.getLegalTurnTree(rolled);
			const path = [];
			while (Object.keys(node).length > 0) {
				const move = Object.keys(node)[0];
				path.push(move);
				node = node[move];
			}
			if (path.length >= 2) {
				selectedPairIndex = pairIndex;
				dice = pair;
				moves = path;
				dfen = rolled;
			}
		}
	}
	assert.ok(moves, 'test setup finds a legal two-micro-move turn');
	for (const move of moves) {
		dfen = DiceChess.applyMove(dfen, move.slice(0, 2), move.slice(2, 4), move[4]);
		assert.equal(typeof dfen, 'string');
	}
	const ended = DiceChess.endTurn(dfen);
	assert.equal(typeof ended, 'string');
	const fenAfter = ended.split(/\s+/).slice(0, 6).join(' ');
	const transcript = {
		completeness: 'complete',
		variant: { id: 'choice-2x2d6', revision: 1 },
		provenance: { diceAlgorithm: fixture.algorithm, rulesVersion: '0.18.2' },
		initialDfen,
		status: { Ended: { over: { result: { Draw: {} }, termination: 'Draw' } } },
		currentTurn: {
			phase: 'Ended',
			offers: deterministicOffers(vector.serverSeed, clientSeeds.white, clientSeeds.black, 1),
			selectedPairIndex: null,
		},
		fairness: {
			commit: vector.commit,
			serverSeed: vector.serverSeed,
			clientSeeds,
		},
		turns: [
			{
				turnNumber: 0,
				activeColor: 'w',
				offers,
				selectedPairIndex,
				dice,
				moves,
				fenAfter,
			},
		],
	};

	assert.deepEqual(verifyTranscript(transcript), { status: 'verified', verifiedTurns: 1 });

	const falseOffer = structuredClone(transcript);
	falseOffer.turns[0].offers[0][0] = (falseOffer.turns[0].offers[0][0] % 6) + 1;
	assert.equal(verifyTranscript(falseOffer).status, 'failed');
	const falseReplay = structuredClone(transcript);
	falseReplay.turns[0].fenAfter = initialDfen;
	assert.equal(verifyTranscript(falseReplay).status, 'failed');
	const falseCommit = structuredClone(transcript);
	falseCommit.fairness.commit = '0'.repeat(64);
	assert.equal(verifyTranscript(falseCommit).status, 'failed');
	const falseTerminalOffer = structuredClone(transcript);
	falseTerminalOffer.currentTurn.offers[0][0] =
		(falseTerminalOffer.currentTurn.offers[0][0] % 6) + 1;
	assert.match(verifyTranscript(falseTerminalOffer).reason, /terminal offer mismatch/);

	const partialTurn = structuredClone(transcript);
	partialTurn.turns[0].moves = moves.slice(0, -1);
	let partialFen = `${initialDfen} ${dice.map((die) => 'PNBRQK'[die - 1]).join('')}`;
	for (const move of partialTurn.turns[0].moves) {
		partialFen = DiceChess.applyMove(partialFen, move.slice(0, 2), move.slice(2, 4), move[4]);
	}
	partialTurn.turns[0].fenAfter = DiceChess.endTurn(partialFen).split(/\s+/).slice(0, 6).join(' ');
	assert.match(verifyTranscript(partialTurn).reason, /ended before exhausting/);
});

test('incomplete transcripts never receive a fairness pass without a terminal reveal', () => {
	assert.deepEqual(verifyTranscript({ completeness: 'incomplete', fairness: null, turns: [] }), {
		status: 'not-verifiable',
		verifiedTurns: 0,
		reason: 'complete fairness reveal required',
	});
});

test('replay failures retain their first reason and report no completed verification', () => {
	const transcript = JSON.parse(
		readFileSync(new URL('./evidence/maximum-consumption.json', import.meta.url), 'utf8'),
	);
	const cases = [
		['missing turn', (bad) => (bad.turns[0] = null), 'order does not match the initial position'],
		[
			'wrong order',
			(bad) => (bad.turns[0].turnNumber = 1),
			'order does not match the initial position',
		],
		[
			'wrong color',
			(bad) => (bad.turns[0].activeColor = 'b'),
			'order does not match the initial position',
		],
		['invalid die', (bad) => (bad.turns[0].offers[1][0] = 0), 'has invalid pair data'],
		[
			'invalid selection',
			(bad) => (bad.turns[0].selectedPairIndex = null),
			'has invalid pair data',
		],
		[
			'wrong selected dice',
			(bad) => (bad.turns[0].dice = [6, 6]),
			'selected dice do not match its offer',
		],
		['missing moves', (bad) => delete bad.turns[0].moves, 'has invalid moves'],
		['excess moves', (bad) => bad.turns[0].moves.push('a1a2'), 'has invalid moves'],
		['illegal pass', (bad) => (bad.turns[0].moves = []), 'passed despite available legal paths'],
		['invalid UCI', (bad) => (bad.turns[0].moves[0] = 'e2-e3'), 'has invalid UCI'],
		['illegal path', (bad) => (bad.turns[0].moves[0] = 'e2e5'), 'is not a legal turn path'],
		[
			'incomplete path',
			(bad) => bad.turns[0].moves.pop(),
			'ended before exhausting its legal path',
		],
		['wrong FEN', (bad) => (bad.turns[0].fenAfter = bad.initialDfen), 'FEN replay mismatch'],
	];
	for (const [label, mutate, reason] of cases) {
		const bad = structuredClone(transcript);
		// A later fairness failure must not mask the earlier replay rejection.
		bad.turns[0].offers[1] = [6, 6];
		mutate(bad);
		assert.deepEqual(
			verifyTranscript(bad),
			{
				status: 'failed',
				verifiedTurns: 0,
				reason: `turn 0 ${reason}`,
			},
			label,
		);
	}
	const badSecondTurn = structuredClone(transcript);
	badSecondTurn.turns.push(structuredClone(badSecondTurn.turns[0]));
	assert.deepEqual(verifyTranscript(badSecondTurn), {
		status: 'failed',
		verifiedTurns: 0,
		reason: 'turn 1 order does not match the initial position',
	});
});

test('fairness and terminal failures preserve verification counts and validation order', () => {
	const transcript = JSON.parse(
		readFileSync(new URL('./evidence/maximum-consumption.json', import.meta.url), 'utf8'),
	);
	const cases = [
		[
			(bad) => {
				bad.provenance.rulesVersion = 'unsupported';
				bad.fairness.serverSeed = null;
			},
			'unsupported transcript provenance',
			0,
		],
		[
			(bad) => {
				bad.status.Ended.over.result = { Draw: {} };
				bad.turns = null;
			},
			'terminal win result mismatch',
			0,
		],
		[(bad) => (bad.fairness.serverSeed = null), 'invalid server seed', 0],
		[(bad) => (bad.fairness.commit = 'invalid'), 'invalid commitment', 0],
		[(bad) => (bad.fairness.commit = '0'.repeat(64)), 'commitment mismatch', 0],
		[(bad) => (bad.fairness.clientSeeds.white = ''), 'client seeds unavailable', 0],
		[(bad) => (bad.turns[0].offers[1] = [6, 6]), 'turn 0 offer mismatch', 1],
		[(bad) => delete bad.currentTurn.offers, 'invalid terminal offers', 1],
		[(bad) => (bad.currentTurn.selectedPairIndex = 0), 'invalid terminal offers', 1],
		[(bad) => (bad.currentTurn.offers = [[6, 6]]), 'terminal offer mismatch', 1],
	];
	for (const [mutate, reason, verifiedTurns] of cases) {
		const bad = structuredClone(transcript);
		mutate(bad);
		assert.deepEqual(verifyTranscript(bad), { status: 'failed', verifiedTurns, reason });
	}
});

test('king capture failures preserve replay, result, and selection boundaries', () => {
	const transcript = JSON.parse(
		readFileSync(new URL('./evidence/king-capture.json', import.meta.url), 'utf8'),
	);
	const cases = [
		[
			(bad) => bad.turns.push(structuredClone(bad.turns[0])),
			'turn 0 continued after king capture',
			0,
		],
		[
			(bad) => (bad.status.Ended.over.termination = 'Resign'),
			'terminal king capture reason mismatch',
			1,
		],
		[
			(bad) => (bad.status.Ended.over.result.Win.side = 'Black'),
			'terminal king capture result mismatch',
			1,
		],
		[(bad) => (bad.currentTurn.offers = []), 'invalid terminal offers', 1],
		[
			(bad) => (bad.currentTurn.selectedPairIndex = null),
			'terminal king capture selection mismatch',
			1,
		],
		[
			(bad) => (bad.currentTurn.selectedPairIndex = 1),
			'terminal king capture selection mismatch',
			1,
		],
	];
	for (const [mutate, reason, verifiedTurns] of cases) {
		const bad = structuredClone(transcript);
		mutate(bad);
		assert.deepEqual(verifyTranscript(bad), { status: 'failed', verifiedTurns, reason });
	}
});

test('king capture records the applied path without toggling the active color', () => {
	const vector = fixture.vectors.find(
		(candidate) => candidate.name === 'ascending-alice-bob-turn-0',
	);
	const initialDfen = '4k3/8/8/8/8/8/4R3/4K3 w - - 0 1';
	let clientSeeds;
	let offers;
	let selectedPairIndex = -1;
	for (let candidate = 0; candidate < 1000 && selectedPairIndex < 0; candidate += 1) {
		clientSeeds = { white: `capture-white-${candidate}`, black: `capture-black-${candidate}` };
		offers = deterministicOffers(vector.serverSeed, clientSeeds.white, clientSeeds.black, 0);
		selectedPairIndex = offers.findIndex((pair) => pair.includes(1) && pair.includes(4));
	}
	assert.notEqual(selectedPairIndex, -1, 'test setup finds a rook and pawn pair');
	const dice = offers[selectedPairIndex];
	const rolled = `${initialDfen} ${dice.map((die) => 'PNBRQK'[die - 1]).join('')}`;
	const tree = DiceChess.getLegalTurnTree(rolled);
	assert.deepEqual(tree.e2e8, {});
	const afterCapture = DiceChess.applyMove(rolled, 'e2', 'e8').split(/\s+/).slice(0, 6).join(' ');
	const transcript = {
		completeness: 'complete',
		variant: { id: 'choice-2x2d6', revision: 1 },
		provenance: { diceAlgorithm: fixture.algorithm, rulesVersion: '0.18.2' },
		initialDfen,
		status: {
			Ended: { over: { result: { Win: { side: 'White' } }, termination: 'KingCaptured' } },
		},
		currentTurn: { phase: 'Ended', offers, selectedPairIndex },
		fairness: {
			commit: vector.commit,
			serverSeed: vector.serverSeed,
			clientSeeds,
		},
		turns: [
			{
				turnNumber: 0,
				activeColor: 'w',
				offers,
				selectedPairIndex,
				dice,
				moves: ['e2e8'],
				fenAfter: afterCapture,
			},
		],
	};
	assert.deepEqual(verifyTranscript(transcript), { status: 'verified', verifiedTurns: 1 });
});
