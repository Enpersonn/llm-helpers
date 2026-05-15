import type { AdapterFactory } from './adapter.js';

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

export type FactoryConfig<T> = T extends AdapterFactory<string, infer TConfig> ? TConfig : never;

// biome-ignore lint/suspicious/noExplicitAny: registry must remain open to factories with any config type (contravariant parameter position)
export type AdapterRegistry = Record<string, AdapterFactory<string, any>>;

export type ProviderConfigs<TRegistry extends AdapterRegistry> = Partial<{
	[K in keyof TRegistry]: FactoryConfig<TRegistry[K]>;
}>;

type NoExtraProviderKeys<TProviders, TRegistry extends AdapterRegistry> =
	Exclude<keyof TProviders, keyof TRegistry> extends never ? TProviders : never;

export type Middleware = (
	fn: (...args: unknown[]) => unknown,
	context: { provider: string; method: string },
) => (...args: unknown[]) => unknown;

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
