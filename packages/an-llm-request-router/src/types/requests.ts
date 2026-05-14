import type { z } from 'zod';
import type { LLMMessage } from './index.js';

export type LLMRequest = {
	model?: string;
	messages: LLMMessage[];
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
};

export type LLMEmbedRequest = {
	model?: string;
	input: string;
	signal?: AbortSignal;
};

export type LLMBatchEmbedRequest = {
	model?: string;
	input: string[];
	signal?: AbortSignal;
};

export type LLMJsonRequest<TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
	model?: string;
	messages: LLMMessage[];
	schema?: TSchema;
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
};
