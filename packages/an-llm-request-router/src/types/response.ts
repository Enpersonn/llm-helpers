import type { InternalProviderName, LLMUsage } from './index.js';

export type LLMResponse = {
	text: string;
	model?: string;
	provider: InternalProviderName;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMJsonResponse<T = unknown> = {
	json: T;
	text: string;
	model?: string;
	provider: InternalProviderName;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMEmbedResponse = {
	embedding: number[];
	model?: string;
	provider: InternalProviderName;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMBatchEmbedResponse = {
	embeddings: number[][];
	model?: string;
	provider: InternalProviderName;
	raw?: unknown;
	usage?: LLMUsage;
};
