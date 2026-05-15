import type z from 'zod';
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

export type ProviderCapabilities = {
	nativeThinking: boolean;
	streaming: boolean;
	vision: boolean;
};

export type ToolProvider = ProviderRequest<'tool', LLMToolRequest, Promise<LLMToolResponse>> & {
	capabilities?: ProviderCapabilities;
};

export type ToolDefinition = {
	name: string;
	description?: string;
	parameters?: Record<string, unknown>;
};

export type ToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content: string;
	toolCalls?: ToolCall[];
	toolCallId?: string;
	toolName?: string;
};

export type LLMUsage = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
};

export type LLMStreamChunk = {
	text: string;
	done?: boolean;
	raw?: unknown;
};
