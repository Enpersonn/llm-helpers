import type { LLMUsage } from '@llm-helpers/types';
import type { AgentEventMap } from './bus.js';
import type { RetryPolicy } from './options.js';

/**
 * Combines an optional caller-supplied AbortSignal with an optional timeout into a single signal.
 *
 * NOTE: `AbortSignal.any()` requires Node 20+. This package targets ES2022 with NodeNext module
 * resolution, which implies a Node 20+ runtime. If you are running on an older Node version,
 * remove the `AbortSignal.any` branch or polyfill it before use.
 */
export const buildCombinedSignal = (signal?: AbortSignal, timeout?: number): AbortSignal | undefined => {
	const signals = [signal, timeout !== undefined ? AbortSignal.timeout(timeout) : undefined].filter(
		(s): s is AbortSignal => s !== undefined,
	);
	if (signals.length === 0) return undefined;
	if (signals.length === 1) return signals[0];
	return AbortSignal.any(signals);
};

export const callWithRetry = async <T>(
	fn: () => Promise<T>,
	policy: RetryPolicy,
	step: number,
	emitRetry: (payload: AgentEventMap['retry']) => void,
): Promise<T> => {
	const maxAttempts = policy.maxAttempts ?? 1;
	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (err) {
			// never retry aborts — the signal is gone and retrying would deadlock
			if (err instanceof DOMException && err.name === 'AbortError') throw err;
			attempt++;
			if (attempt >= maxAttempts) throw err;
			const delayResult = policy.backoff?.(attempt, err);
			if (delayResult === false) throw err;
			const delayMs = typeof delayResult === 'number' ? delayResult : 0;
			emitRetry({ step, attempt, error: err, delayMs });
			if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
		}
	}
};

export const accumulateUsage = (total: LLMUsage, delta?: LLMUsage): void => {
	if (!delta) return;
	total.inputTokens = (total.inputTokens ?? 0) + (delta.inputTokens ?? 0);
	total.outputTokens = (total.outputTokens ?? 0) + (delta.outputTokens ?? 0);
	total.totalTokens = (total.totalTokens ?? 0) + (delta.totalTokens ?? 0);
};
