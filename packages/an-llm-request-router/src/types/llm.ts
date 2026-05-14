import type z from 'zod';
import type { AdapterFactory } from './adapter.js';
import type { LLMBatchEmbedRequest, LLMEmbedRequest, LLMJsonRequest, LLMRequest } from './requests.js';
import type { LLMBatchEmbedResponse, LLMEmbedResponse, LLMJsonResponse, LLMResponse } from './response.js';

export type LLMMessage = {
	role: 'system' | 'user' | 'assistant';
	content: string;
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

export interface LLMProvider<TRegistry extends string> {
	chat(request: LLMRequest<TRegistry>): Promise<LLMResponse>;

	json?<TSchema extends z.ZodTypeAny>(
		request: LLMJsonRequest<TRegistry, TSchema>,
	): Promise<LLMJsonResponse<z.infer<TSchema>>>;

	embed?(request: LLMEmbedRequest<TRegistry>): Promise<LLMEmbedResponse>;

	embedMany?(request: LLMBatchEmbedRequest<TRegistry>): Promise<LLMBatchEmbedResponse>;

	stream?(request: LLMRequest<TRegistry>): AsyncIterable<LLMStreamChunk>;
}

type ProviderKey<TRegistry extends AdapterRegistry> = Extract<keyof TRegistry, string>;

export type EnabledProvider<TConfig> = TConfig extends { providers: infer P } ? Extract<keyof P, string> : never;

export type FactoryConfig<T> = T extends AdapterFactory<any, infer TConfig> ? TConfig : never;

export type AdapterRegistry = Record<string, AdapterFactory<string, any>>;

export type MergeRegistries<TBase extends AdapterRegistry, TCustom extends AdapterRegistry> = Omit<
	TBase,
	keyof TCustom
> &
	TCustom;

export type LLMConfig<TRegistry extends AdapterRegistry> = {
	defaultProvider: ProviderKey<TRegistry>;

	providers: {
		[K in keyof TRegistry]: FactoryConfig<TRegistry[K]>;
	};

	defaults?: {
		temperature?: number;
		maxTokens?: number;
	};
};
