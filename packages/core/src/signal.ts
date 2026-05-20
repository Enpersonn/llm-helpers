export const buildCombinedSignal = (signal?: AbortSignal, timeout?: number): AbortSignal | undefined => {
	const signals = [signal, timeout !== undefined ? AbortSignal.timeout(timeout) : undefined].filter(
		(s): s is AbortSignal => s !== undefined,
	);
	if (signals.length === 0) return undefined;
	if (signals.length === 1) return signals[0];
	return AbortSignal.any(signals);
};

export const withTimeout = <T>(promise: Promise<T>, ms: number, label?: string): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(
				() => reject(new Error(label ? `'${label}' timed out after ${ms}ms` : `Operation timed out after ${ms}ms`)),
				ms,
			),
		),
	]);
};
