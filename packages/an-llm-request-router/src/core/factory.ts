import type { AdapterFactory, LLMAdapter } from '../types/index.js';

type AdapterBody = Record<string, unknown>;

export function adapterFactory<const TProvider extends string, TConfig, TBody extends AdapterBody>(
	provider: TProvider,
	create: (config: TConfig) => TBody,
): AdapterFactory<TProvider, TConfig, LLMAdapter<TProvider, TConfig> & TBody> {
	function makeFactory(
		innerCreate: (config: TConfig) => TBody,
	): AdapterFactory<TProvider, TConfig, LLMAdapter<TProvider, TConfig> & TBody> {
		return {
			provider,

			create(config) {
				return { provider, config, ...innerCreate(config) } as LLMAdapter<TProvider, TConfig> & TBody;
			},

			extend(overrideFn) {
				return makeFactory((config) => {
					const body = innerCreate(config);
					const overrides = overrideFn(
						body as unknown as Omit<LLMAdapter<TProvider, TConfig> & TBody, 'provider' | 'config'>,
						config,
					);
					return { ...body, ...overrides } as TBody;
				});
			},
		};
	}

	return makeFactory(create);
}
