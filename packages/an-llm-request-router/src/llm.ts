import type { output, ZodType } from 'zod';
import { type InternalAdapters, internalAdapters } from './adapters/index.js';
import type {
	AdapterRegistry,
	EnabledProvider,
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
} from './types/index.js';

export class LLM<
	const TCustom extends AdapterRegistry = {},
	const TRegistry extends AdapterRegistry = MergeRegistries<InternalAdapters, TCustom>,
	const TConfig extends LLMConfig<TRegistry> = LLMConfig<TRegistry>,
> implements LLMProvider<EnabledProvider<TConfig>>
{
	private registry: TRegistry;

	constructor(
		private config: TConfig,
		customAdapters?: TCustom,
	) {
		this.registry = {
			...internalAdapters,
			...customAdapters,
		} as unknown as TRegistry;
	}

	private getProvider(name?: EnabledProvider<TConfig>) {
		const providerName = name ?? this.config.defaultProvider;

		const factory = this.registry[providerName];
		const providerConfig = this.config.providers[providerName];

		if (!providerConfig) {
			throw new Error(`Missing config for provider: ${String(providerName)}`);
		}

		return factory.create(providerConfig);
	}

	async chat(request: LLMRequest<EnabledProvider<TConfig>>): Promise<LLMResponse> {
		const provider = this.getProvider(request.provider);

		return provider.chat({
			...request,
			model: request.model ?? this.config.providers[provider.provider as EnabledProvider<TConfig>]?.model,
		});
	}

	json<TSchema extends ZodType>(
		request: LLMJsonRequest<EnabledProvider<TConfig>, TSchema>,
	): Promise<LLMJsonResponse<output<TSchema>>> {
		const provider = this.getProvider(request.provider);

		if (!provider.json) {
			throw new Error(`Provider ${provider.provider} does not support json returns`);
		}

		return provider.json({
			...request,
			model: request.model ?? this.config.providers[provider.provider as EnabledProvider<TConfig>]?.model,
		});
	}

	stream(request: LLMRequest<EnabledProvider<TConfig>>): AsyncIterable<LLMStreamChunk> {
		const provider = this.getProvider(request.provider);

		if (!provider.stream) {
			throw new Error(`Provider ${provider.provider} does not support streaming`);
		}

		return provider.stream({
			...request,
			model: request.model ?? this.config.providers[provider.provider as EnabledProvider<TConfig>]?.model,
		});
	}

	embed(request: LLMEmbedRequest<EnabledProvider<TConfig>>): Promise<LLMEmbedResponse> {
		const provider = this.getProvider(request.provider);

		if (!provider.embed) {
			throw new Error(`Provider ${provider.provider} does not support embeding`);
		}

		return provider.embed({
			...request,
			model: request.model ?? this.config.providers[provider.provider as EnabledProvider<TConfig>]?.model,
		});
	}
}
