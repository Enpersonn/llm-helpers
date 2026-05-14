import type { LLMStreamChunk } from './llm.js';
import type { LLMBatchEmbedRequest, LLMEmbedRequest, LLMRequest } from './requests.js';
import type { LLMBatchEmbedResponse, LLMEmbedResponse } from './response.js';

export type StreamingProvider<P extends string> = {
	stream(request: LLMRequest<P>): AsyncIterable<LLMStreamChunk>;
};

export type EmbeddingProvider<P extends string> = {
	embed(request: LLMEmbedRequest<P>): Promise<LLMEmbedResponse>;
	embedMany?(request: LLMBatchEmbedRequest<P>): Promise<LLMBatchEmbedResponse>;
};
