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

export type FactoryConfig<T> = T extends AdapterFactory<any, infer TConfig> ? TConfig : never;

export type AdapterRegistry = Record<string, AdapterFactory<string, any>>;

export type MergeRegistries<TBase extends AdapterRegistry, TCustom extends AdapterRegistry> = Omit<
	TBase,
	keyof TCustom
> &
	TCustom;

export type ProviderConfigs<TRegistry extends AdapterRegistry> = Partial<{
	[K in keyof TRegistry]: FactoryConfig<TRegistry[K]>;
}>;

type NoExtraProviderKeys<TProviders, TRegistry extends AdapterRegistry> =
	Exclude<keyof TProviders, keyof TRegistry> extends never ? TProviders : never;

export type LLMConfig<TRegistry extends AdapterRegistry, TProviders extends ProviderConfigs<TRegistry>> = {
	defaultProvider: Extract<keyof TProviders, string>;
	providers: NoExtraProviderKeys<TProviders, TRegistry> & {
		[K in keyof TProviders]: K extends keyof TRegistry ? FactoryConfig<TRegistry[K]> : never;
	};

	defaults?: {
		temperature?: number;
		maxTokens?: number;
	};
};
