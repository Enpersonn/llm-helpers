import type {
	ChatProvider,
	EmbeddingBatchProvider,
	EmbeddingProvider,
	JsonProvider,
	StreamingProvider,
	ToolProvider,
	VisionProvider,
} from '@llm-helpers/types';

function hasMethod(x: unknown, method: string): boolean {
	return (
		typeof x === 'object' &&
		x !== null &&
		method in x &&
		typeof (x as Record<string, unknown>)[method] === 'function'
	);
}

export function isChatProvider(x: unknown): x is ChatProvider {
	return hasMethod(x, 'chat');
}
export function isStreamingProvider(x: unknown): x is StreamingProvider {
	return hasMethod(x, 'stream');
}
export function isJsonProvider(x: unknown): x is JsonProvider {
	return hasMethod(x, 'json');
}
export function isEmbeddingProvider(x: unknown): x is EmbeddingProvider {
	return hasMethod(x, 'embed');
}
export function isEmbeddingBatchProvider(x: unknown): x is EmbeddingBatchProvider {
	return hasMethod(x, 'embedMany');
}
export function isVisionProvider(x: unknown): x is VisionProvider {
	return hasMethod(x, 'vision');
}
export function isToolProvider(x: unknown): x is ToolProvider {
	return hasMethod(x, 'tool');
}
