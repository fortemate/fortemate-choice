/** Regression for child exit preceding the final stdout/stderr chunks. No services are started. */
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import test from 'node:test';
import { AcceptanceEnvironment, captureChildOutput } from './environment.mjs';

test('database output resolves only after close and preserves final UTF-8 chunks', async () => {
	const child = new EventEmitter();
	child.stdin = new PassThrough();
	child.stdout = new PassThrough();
	child.stderr = new PassThrough();
	let settled = false;
	const completion = captureChildOutput(child, 'query').then((result) => {
		settled = true;
		return result;
	});
	child.stdout.write('{"value":"');
	child.emit('exit', 0);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(settled, false, 'exit alone must not complete the database read');
	const text = Buffer.from('é"}');
	child.stdout.write(text.subarray(0, 1));
	child.stdout.end(text.subarray(1));
	child.stderr.end('last diagnostic');
	await Promise.all([
		new Promise((resolve) => child.stdout.on('end', resolve)),
		new Promise((resolve) => child.stderr.on('end', resolve)),
	]);
	child.emit('close', 0);
	assert.deepEqual(await completion, { stdout: '{"value":"é"}', stderr: 'last diagnostic' });
});

test('cleanup stops independent API processes concurrently and tolerates stop errors', async () => {
	const environment = Object.create(AcceptanceEnvironment.prototype);
	Object.assign(environment, {
		children: [],
		state: '/tmp/laboratory-acceptance-test',
		script: '/tmp/process.sh',
		bridges: [],
		proxySockets: new Set(),
		owned: false,
		cleaning: false,
		cleanupPromise: null,
	});
	let activeStops = 0;
	let maximumConcurrentStops = 0;
	const stoppedModes = [];
	environment.process = async (_action, mode) => {
		stoppedModes.push(mode);
		activeStops++;
		maximumConcurrentStops = Math.max(maximumConcurrentStops, activeStops);
		await new Promise((resolve) => setImmediate(resolve));
		activeStops--;
		if (mode === 'laboratory') throw new Error('already stopped');
	};

	await Promise.all([environment.cleanup(), environment.cleanup()]);
	assert.equal(maximumConcurrentStops, 2);
	assert.deepEqual(stoppedModes, ['laboratory', 'classic']);
});
