import type { AdapterRegistry } from './llm.js';

export type LLMAdapter<TProvider extends string = string, TConfig = unknown> = {
	provider: TProvider;
	config: TConfig;
};

export type AdapterFactory<
	TProvider extends string,
	TConfig,
	TAdapter extends LLMAdapter<TProvider, TConfig> = LLMAdapter<TProvider, TConfig>,
> = {
	provider: TProvider;
	create(config: TConfig): TAdapter;
	extend(
		overrideFn: (
			base: Omit<TAdapter, 'provider' | 'config'>,
			config: TConfig,
		) => Partial<Omit<TAdapter, 'provider' | 'config'>>,
	): AdapterFactory<TProvider, TConfig, TAdapter>;
};

export type CreatedAdapter<TRegistry extends AdapterRegistry, TName extends keyof TRegistry> = ReturnType<
	TRegistry[TName]['create']
>;
