import type { InternalAdapters } from '../adapters/index.js';
import type { LLMUsage } from './index.js';

export type LLMResponse = {
	text: string;
	model?: string;
	provider: string;
	raw?: unknown;
};

export type LLMJsonResponse<T = unknown> = {
	json: T;
	text: string;
	model?: string;
	provider: InternalAdapters;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMEmbedResponse = {
	embedding: number[];
	model?: string;
	provider: InternalAdapters;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMBatchEmbedResponse = {
	embeddings: number[][];
	model?: string;
	provider: InternalAdapters;
	raw?: unknown;
	usage?: LLMUsage;
};
