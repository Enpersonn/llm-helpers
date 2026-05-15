export const withTimeout = <T>(promise: Promise<T>, ms: number, toolName: string): Promise<T> => {
	return Promise.race([
		promise,
		new Promise<never>((_, reject) =>
			setTimeout(() => reject(new Error(`Tool '${toolName}' timed out after ${ms}ms`)), ms),
		),
	]);
};
