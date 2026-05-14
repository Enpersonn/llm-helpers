import { GoogleGenAI } from '@google/genai';

import type { AdapterFactory, InternalLLMAdapter, LLMMessage } from '../types/index.js';

type GeminiConfig = {
	apiKey: string;
	model: string;
};

type VisionRequest = {
	image: Uint8Array;
	prompt: string;
};

type VisionResponse = {
	text: string;
	raw?: unknown;
};

type GeminiAdapter = InternalLLMAdapter<'gemini', GeminiConfig> & VisionProvider;

type VisionProvider = {
	vision(request: VisionRequest): Promise<VisionResponse>;
};
export const geminiFactory = {
	provider: 'gemini',

	create(config: GeminiConfig): GeminiAdapter {
		return createGeminiAdapter(config);
	},
} satisfies AdapterFactory<'gemini', GeminiConfig>;

export function createGeminiAdapter(config: GeminiConfig): GeminiAdapter {
	const ai = new GoogleGenAI({
		apiKey: config.apiKey,
	});

	return {
		provider: 'gemini',
		config,

		async chat(request) {
			const model = request.model ?? config.model;

			const response = await ai.models.generateContent({
				model,

				contents: toGeminiContents(request.messages),

				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					responseMimeType: request.json ? 'application/json' : 'text/plain',
				},
			});

			return {
				provider: 'gemini',
				model,
				text: response.text ?? '',
				raw: response,
			};
		},

		async *stream(request) {
			const model = request.model ?? config.model;

			const response = await ai.models.generateContentStream({
				model,

				contents: toGeminiContents(request.messages),

				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					responseMimeType: request.json ? 'application/json' : 'text/plain',
				},
			});

			for await (const chunk of response) {
				yield {
					text: chunk.text ?? '',
					done: false,
					raw: chunk,
				};
			}

			yield {
				text: '',
				done: true,
			};
		},

		async vision(request) {
			return {
				text: '',
				raw: '',
			};
		},
	};
}

function toGeminiContents(messages: LLMMessage[]) {
	return messages.map((message) => ({
		role: message.role === 'assistant' ? 'model' : 'user',

		parts: [
			{
				text: message.content,
			},
		],
	}));
}
