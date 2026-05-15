import type z from 'zod';
import type { LLMStreamChunk } from './llm.js';
import type { LLMBatchEmbedRequest, LLMEmbedRequest, LLMJsonRequest, LLMRequest, LLMToolRequest } from './requests.js';
import type {
	LLMBatchEmbedResponse,
	LLMEmbedResponse,
	LLMJsonResponse,
	LLMResponse,
	LLMToolResponse,
} from './response.js';

export type ProviderRequest<N extends string, Req, Res> = {
	[K in N]: (request: Req) => Res;
};

export type ChatProvider = ProviderRequest<'chat', LLMRequest, Promise<LLMResponse>>;

export type JsonProvider = {
	json<TSchema extends z.ZodTypeAny>(request: LLMJsonRequest<TSchema>): Promise<LLMJsonResponse<z.infer<TSchema>>>;
};

export type StreamingProvider = ProviderRequest<'stream', LLMRequest, AsyncIterable<LLMStreamChunk>>;

export type EmbeddingProvider = ProviderRequest<'embed', LLMEmbedRequest, Promise<LLMEmbedResponse>>;
export type EmbeddingBatchProvider = ProviderRequest<'embedMany', LLMBatchEmbedRequest, Promise<LLMBatchEmbedResponse>>;

export type VisionRequest = {
	image: Uint8Array;
	prompt: string;
};

export type VisionResponse = {
	text: string;
	raw?: unknown;
};

export type VisionProvider = ProviderRequest<'vision', VisionRequest, Promise<VisionResponse>>;

export type ToolProvider = ProviderRequest<'tool', LLMToolRequest, Promise<LLMToolResponse>>;
