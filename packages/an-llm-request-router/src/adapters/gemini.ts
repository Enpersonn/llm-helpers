import type { LLMMessage } from '../types/index.js';
import type { ChatProvider, StreamingProvider, VisionProvider } from '../types/providers.js';
import { adapterFactory } from './factory.js';

type GeminiAdapter = ChatProvider & StreamingProvider & VisionProvider;

export const geminiFactory = adapterFactory('gemini', (config: { apiKey: string; model: string }): GeminiAdapter => {
	let ai: import('@google/genai').GoogleGenAI | undefined;

	async function getClient() {
		if (ai) return ai;

		const { GoogleGenAI } = await import('@google/genai');

		ai = new GoogleGenAI({
			apiKey: config.apiKey,
		});

		return ai;
	}

	return {
		async chat(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;

			const response = await ai.models.generateContent({
				model,

				contents: toGeminiContents(request.messages),

				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
				},
			});

			return {
				text: response.text ?? '',
				model,
				provider: 'gemini',
				raw: response,
			};
		},

		async *stream(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;

			const response = await ai.models.generateContentStream({
				model,

				contents: toGeminiContents(request.messages),

				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
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
});

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
