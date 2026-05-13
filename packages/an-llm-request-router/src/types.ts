import { z } from "zod";
export type LLMMessage = {
	role: "system" | "user" | "assistant";
	content: string;
};
export const ProviderNames = [
	"ollama",
	"openai",
	"anthropic",
	"gemini",
] as const;

export type ProviderName = (typeof ProviderNames)[number];

export const ProviderNameSchema = z.enum(ProviderNames);

export type LLMRequest = {
	provider?: ProviderName;
	model?: string;
	messages: LLMMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	json?: boolean;
	signal?: AbortSignal;
};

export type LLMResponse = {
	text: string;
	model?: string;
	provider: ProviderName;
	raw?: unknown;
};

export type LLMStreamChunk = {
	text: string;
	done?: boolean;
	raw?: unknown;
};

export interface LLMAdapter {
	provider: ProviderName;
	chat(request: LLMRequest): Promise<LLMResponse>;
	stream?(request: LLMRequest): AsyncIterable<LLMStreamChunk>;
}
export type LLMConfig = {
	defaultProvider: ProviderName;

	providers: {
		ollama?: {
			endpoint: string;
			model: string;
		};

		openai?: {
			apiKey: string;
			model: string;
		};

		anthropic?: {
			apiKey: string;
			model: string;
		};

		gemini?: {
			apiKey: string;
			model: string;
		};
	};

	defaults?: {
		temperature?: number;
		maxTokens?: number;
	};
};
