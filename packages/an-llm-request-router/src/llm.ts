import type { output, ZodType } from 'zod';
import { type InternalAdapters, internalAdapters } from './adapters/index.js';
import type {
	AdapterRegistry,
	CreatedAdapter,
	FactoryConfig,
	LLMConfig,
	LLMEmbedRequest,
	LLMEmbedResponse,
	LLMJsonRequest,
	LLMJsonResponse,
	LLMProvider,
	LLMRequest,
	LLMResponse,
	LLMStreamChunk,
	MergeRegistries,
	ProviderConfigs,
} from './types/index.js';

export function createLLM<
	const TCustom extends AdapterRegistry = {},
	const TRegistry extends AdapterRegistry = MergeRegistries<InternalAdapters, TCustom>,
	const TProviders extends ProviderConfigs<TRegistry> = ProviderConfigs<TRegistry>,
>(config: LLMConfig<TRegistry, TProviders>, customAdapters?: TCustom) {
	const registry = {
		...internalAdapters,
		...customAdapters,
	} as unknown as TRegistry;

	return new LLM(registry, config);
}

export class LLM<
	TRegistry extends AdapterRegistry,
	TProviders extends Partial<{
		[K in keyof TRegistry]: FactoryConfig<TRegistry[K]>;
	}>,
> implements LLMProvider<Extract<keyof TProviders, string>>
{
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
	) {}

	private getProvider(name?: Extract<keyof TProviders, string>) {
		const providerName = name ?? this.config.defaultProvider;

		const factory = this.registry[providerName];
		const providerConfig = this.config.providers[providerName];

		if (!providerConfig) {
			throw new Error(`Missing config for provider: ${String(providerName)}`);
		}

		return factory.create(providerConfig);
	}

	use<TName extends Extract<keyof TProviders, string>>(name: TName): CreatedAdapter<TRegistry, TName> {
		const factory = this.registry[name];
		const providerConfig = this.config.providers[name];

		if (!providerConfig) {
			throw new Error(`Missing config for provider: ${String(name)}`);
		}

		return factory.create(providerConfig) as CreatedAdapter<TRegistry, TName>;
	}

	async chat(request: LLMRequest<Extract<keyof TProviders, string>>): Promise<LLMResponse> {
		const provider = this.getProvider(request.provider);

		return provider.chat({
			...request,
			model:
				request.model ?? this.config.providers[provider.provider as Extract<keyof TProviders, string>]?.model,
		});
	}

	json<TSchema extends ZodType>(
		request: LLMJsonRequest<Extract<keyof TProviders, string>, TSchema>,
	): Promise<LLMJsonResponse<output<TSchema>>> {
		const provider = this.getProvider(request.provider);

		if (!provider.json) {
			throw new Error(`Provider ${provider.provider} does not support json returns`);
		}

		return provider.json({
			...request,
			model:
				request.model ?? this.config.providers[provider.provider as Extract<keyof TProviders, string>]?.model,
		});
	}

	stream(request: LLMRequest<Extract<keyof TProviders, string>>): AsyncIterable<LLMStreamChunk> {
		const provider = this.getProvider(request.provider);

		if (!provider.stream) {
			throw new Error(`Provider ${provider.provider} does not support streaming`);
		}

		return provider.stream({
			...request,
			model:
				request.model ?? this.config.providers[provider.provider as Extract<keyof TProviders, string>]?.model,
		});
	}

	embed(request: LLMEmbedRequest<Extract<keyof TProviders, string>>): Promise<LLMEmbedResponse> {
		const provider = this.getProvider(request.provider);

		if (!provider.embed) {
			throw new Error(`Provider ${provider.provider} does not support embeding`);
		}

		return provider.embed({
			...request,
			model:
				request.model ?? this.config.providers[provider.provider as Extract<keyof TProviders, string>]?.model,
		});
	}
}
