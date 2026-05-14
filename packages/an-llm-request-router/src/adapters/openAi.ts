import type { ChatProvider, StreamingProvider } from '../types/providers.js';
import { adapterFactory } from './factory.js';

type OpenAIAdapter = ChatProvider & StreamingProvider;

export const openaiFactory = adapterFactory('openai', (config: { apiKey: string; model: string }): OpenAIAdapter => {
	let client: import('openai').default | undefined;

	async function getClient() {
		if (client) return client;

		const OpenAI = await import('openai').then((mod) => mod.default);

		client = new OpenAI({
			apiKey: config.apiKey,
		});

		return client;
	}

	return {
		async chat(request) {
			const client = await getClient();
			const model = request.model ?? config.model;

			const response = await client.chat.completions.create({
				model,
				messages: request.messages,
				temperature: request.temperature,
				max_tokens: request.maxTokens,
			});

			return {
				text: response.choices[0]?.message?.content ?? '',
				model,
				provider: 'openai',
				raw: response,
			};
		},

		async *stream(request) {
			const client = await getClient();
			const model = request.model ?? config.model;

			const stream = await client.chat.completions.create({
				model,
				messages: request.messages,
				temperature: request.temperature,
				max_tokens: request.maxTokens,
				stream: true,
			});

			for await (const chunk of stream) {
				yield {
					text: chunk.choices[0]?.delta?.content ?? '',
					done: false,
					raw: chunk,
				};
			}

			yield {
				text: '',
				done: true,
			};
		},
	};
});
