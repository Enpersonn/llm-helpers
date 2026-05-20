import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { buildCombinedSignal, withTimeout } from '../src/index.ts';

test('withTimeout rejects with the provided label', async () => {
	await assert.rejects(withTimeout(new Promise(() => undefined), 5, 'slow operation'), /slow operation/);
});

test('buildCombinedSignal aborts when the timeout elapses', async () => {
	const signal = buildCombinedSignal(undefined, 5);
	assert.ok(signal);

	await delay(10);

	assert.equal(signal.aborted, true);
	assert.ok(signal.reason instanceof DOMException);
	assert.equal(signal.reason.name, 'TimeoutError');
});
