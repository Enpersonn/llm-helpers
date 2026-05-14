import type { AdapterRegistry, LLMProvider } from './llm.js';

export interface InternalLLMAdapter<TProvider extends string = string, TConfig = unknown>
	extends LLMProvider<TProvider> {
	provider: TProvider;
	config: TConfig;
}

export type AdapterFactory<
	TProvider extends string,
	TConfig,
	TAdapter extends InternalLLMAdapter<TProvider, TConfig> = InternalLLMAdapter<TProvider, TConfig>,
> = {
	provider: TProvider;
	create(config: TConfig): TAdapter;
};

export type CreatedAdapter<TRegistry extends AdapterRegistry, TName extends keyof TRegistry> = ReturnType<
	TRegistry[TName]['create']
>;
