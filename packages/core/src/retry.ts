export type RetryPolicy = {
	maxAttempts?: number;
	backoff?: (attempt: number, error: unknown) => number | false;
};

export const callWithRetry = async <T>(
	fn: () => Promise<T>,
	policy: RetryPolicy,
	onRetry?: (attempt: number, error: unknown, delayMs: number) => void,
): Promise<T> => {
	const maxAttempts = policy.maxAttempts ?? 1;
	let attempt = 0;
	while (true) {
		try {
			return await fn();
		} catch (err) {
			if (err instanceof DOMException && err.name === 'AbortError') throw err;
			attempt++;
			if (attempt >= maxAttempts) throw err;
			const delayResult = policy.backoff?.(attempt, err);
			if (delayResult === false) throw err;
			const delayMs = typeof delayResult === 'number' ? delayResult : 0;
			onRetry?.(attempt, err, delayMs);
			if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
		}
	}
};
