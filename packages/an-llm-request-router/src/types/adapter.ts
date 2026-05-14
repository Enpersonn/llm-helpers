import type { LLMProvider } from './llm.js';

export interface InternalLLMAdapter<TProvider extends string = string, TConfig = unknown>
	extends LLMProvider<TProvider> {
	provider: TProvider;
	config: TConfig;
}

export type AdapterFactory<TProvider extends string, TConfig> = {
	provider: TProvider;
	create(config: TConfig): InternalLLMAdapter<TProvider>;
};
