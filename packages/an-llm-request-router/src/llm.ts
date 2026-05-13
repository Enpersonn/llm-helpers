import type {
	LLMAdapter,
	LLMConfig,
	LLMRequest,
	LLMResponse,
	LLMStreamChunk,
	ProviderName,
} from "./types.js";

interface LLMProvider {
	chat(request: LLMRequest): Promise<LLMResponse>;
	stream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}

export class LLM implements LLMProvider {
	constructor(
		private config: LLMConfig,
		private providers: Record<ProviderName, LLMAdapter>,
	) {}

	private getProvider(type?: ProviderName) {
		const providerName = type ?? this.config.defaultProvider;
		const provider = this.providers[providerName];

		if (!provider) {
			throw new Error(`Unknown LLM provider: ${providerName}`);
		}

		return provider;
	}

	async chat(request: LLMRequest): Promise<LLMResponse> {
		const provider = this.getProvider(request.provider);

		return provider.chat({
			...request,
			model: request.model ?? this.config.providers[provider.provider]?.model,
		});
	}

	stream(request: LLMRequest): AsyncIterable<LLMStreamChunk> {
		const provider = this.getProvider(request.provider);

		if (!provider.stream) {
			throw new Error(
				`Provider ${provider.provider} does not support streaming`,
			);
		}

		return provider.stream({
			...request,
			model: request.model ?? this.config.providers[provider.provider]?.model,
		});
	}
}
