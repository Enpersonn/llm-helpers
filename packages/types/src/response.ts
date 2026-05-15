import type { LLMUsage, ToolCall } from './providers.js';

export type LLMResponse = {
	text: string;
	model?: string;
	provider: string;
	raw?: unknown;
	usage?: LLMUsage;
	thinkingContent?: string;
};

export type LLMJsonResponse<T = unknown> = {
	json: T;
	text: string;
	model?: string;
	provider: string;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMEmbedResponse = {
	embedding: number[];
	model?: string;
	provider: string;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMBatchEmbedResponse = {
	embeddings: number[][];
	model?: string;
	provider: string;
	raw?: unknown;
	usage?: LLMUsage;
};

export type LLMToolResponse = {
	text: string;
	model?: string;
	provider: string;
	raw?: unknown;
	usage?: LLMUsage;
	toolCalls: ToolCall[];
	finishReason: 'stop' | 'tool_calls';
	thinkingContent?: string;
};
