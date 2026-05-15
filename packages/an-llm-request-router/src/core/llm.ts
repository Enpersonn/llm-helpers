import type { AdapterRegistry, FactoryConfig, LLMConfig, Middleware, ProviderConfigs } from '../types/index.js';

export function createLLM<
	const TCustom extends AdapterRegistry = {},
	const TRegistry extends AdapterRegistry = TCustom,
	const TProviders extends ProviderConfigs<TRegistry> = ProviderConfigs<TRegistry>,
>(config: LLMConfig<TRegistry, TProviders>, options?: { adapters?: TCustom; middleware?: Middleware }) {
	const registry = {
		...options?.adapters,
	} as unknown as TRegistry;

	return new LLM(registry, config, options?.middleware);
}

export class LLM<
	TRegistry extends AdapterRegistry,
	TProviders extends Partial<{
		[K in keyof TRegistry]: FactoryConfig<TRegistry[K]>;
	}>,
> {
	private cache = new Map<string, unknown>();

	constructor(
		private registry: TRegistry,
		private config: {
			defaultProvider: Extract<keyof TProviders, string>;
			providers: TProviders;
			defaults?: {
				temperature?: number;
				maxTokens?: number;
			};
		},
		private middleware?: Middleware,
	) {}

	use<TName extends Extract<keyof TProviders, string> & keyof TRegistry>(
		name: TName,
	): TName extends keyof TRegistry ? ReturnType<TRegistry[TName]['create']> : never {
		type Result = TName extends keyof TRegistry ? ReturnType<TRegistry[TName]['create']> : never;

		if (this.cache.has(name)) return this.cache.get(name) as Result;

		const factory = this.registry[name];
		const providerConfig = this.config.providers[name];

		if (!providerConfig) {
			throw new Error(`Missing config for provider: ${String(name)}`);
		}

		let adapter: Result = factory.create(providerConfig) as Result;

		if (this.middleware) {
			const mw = this.middleware;
			adapter = Object.fromEntries(
				Object.entries(adapter as object).map(([key, value]) => [
					key,
					typeof value === 'function'
						? mw(value as (...args: unknown[]) => unknown, { provider: name, method: key })
						: value,
				]),
			) as Result;
		}

		this.cache.set(name, adapter);
		return adapter;
	}

	default() {
		return this.use(this.config.defaultProvider);
	}
}
