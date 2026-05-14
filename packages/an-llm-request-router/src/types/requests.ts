import type { z } from 'zod';
import type { LLMMessage } from './index.js';

export type LLMRequest<P extends string> = {
	provider?: P;
	model?: string;
	messages: LLMMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	json?: boolean;
	signal?: AbortSignal;
};

export type LLMEmbedRequest<P extends string> = {
	provider?: P;
	model?: string;
	input: string;
	signal?: AbortSignal;
};

export type LLMBatchEmbedRequest<P extends string> = {
	provider?: P;
	model?: string;
	input: string[];
	signal?: AbortSignal;
};

export type LLMJsonRequest<P extends string, TSchema extends z.ZodTypeAny = z.ZodTypeAny> = {
	provider?: P;
	model?: string;
	messages: LLMMessage[];
	schema?: TSchema;
	temperature?: number;
	maxTokens?: number;
	signal?: AbortSignal;
};
