import type { LLMMessage, ToolCall } from '../../types/index.js';
import type {
	ChatProvider,
	EmbeddingBatchProvider,
	EmbeddingProvider,
	JsonProvider,
	StreamingProvider,
	ToolProvider,
	VisionProvider,
} from '../../types/providers.js';
import { uint8ToBase64 } from './image-converter.js';

export type OpenAICompatAdapter = ChatProvider &
	StreamingProvider &
	VisionProvider &
	EmbeddingProvider &
	EmbeddingBatchProvider &
	JsonProvider &
	ToolProvider;

export function makeOpenAICompatMethods(
	getClient: () => Promise<import('openai').default>,
	providerName: string,
	getDefaultModel: () => string,
): OpenAICompatAdapter {
	return {
		async chat(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			const response = await client.chat.completions.create(
				{
					model,
					messages: toOpenAIMessages(request.messages),
					temperature: request.temperature,
					max_tokens: request.maxTokens,
				},
				{ signal: request.signal },
			);

			return {
				text: response.choices[0]?.message?.content ?? '',
				model,
				provider: providerName,
				raw: response,
				usage: {
					inputTokens: response.usage?.prompt_tokens,
					outputTokens: response.usage?.completion_tokens,
					totalTokens: response.usage?.total_tokens,
				},
			};
		},

		async *stream(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			const stream = await client.chat.completions.create(
				{
					model,
					messages: toOpenAIMessages(request.messages),
					temperature: request.temperature,
					max_tokens: request.maxTokens,
					stream: true,
				},
				{ signal: request.signal },
			);

			for await (const chunk of stream) {
				yield { text: chunk.choices[0]?.delta?.content ?? '', done: false, raw: chunk };
			}

			yield { text: '', done: true };
		},

		async vision(request) {
			const client = await getClient();
			const base64 = uint8ToBase64(request.image);

			const response = await client.chat.completions.create({
				model: getDefaultModel(),
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: request.prompt },
							{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${base64}` } },
						],
					},
				],
			});

			return { text: response.choices[0]?.message?.content ?? '', raw: response };
		},

		async embed(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			const response = await client.embeddings.create(
				{ model, input: request.input },
				{ signal: request.signal },
			);

			return {
				embedding: response.data[0]?.embedding ?? [],
				model,
				provider: providerName,
				raw: response,
				usage: {
					inputTokens: response.usage?.prompt_tokens,
					totalTokens: response.usage?.total_tokens,
				},
			};
		},

		async embedMany(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			const response = await client.embeddings.create(
				{ model, input: request.input },
				{ signal: request.signal },
			);

			return {
				embeddings: response.data.map((d) => d.embedding),
				model,
				provider: providerName,
				raw: response,
				usage: {
					inputTokens: response.usage?.prompt_tokens,
					totalTokens: response.usage?.total_tokens,
				},
			};
		},

		async json(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			let responseFormat: Record<string, unknown>;
			if (request.schema) {
				const { z } = await import('zod');
				responseFormat = {
					type: 'json_schema',
					json_schema: { name: 'response', strict: true, schema: z.toJSONSchema(request.schema) },
				};
			} else {
				responseFormat = { type: 'json_object' };
			}

			const response = await client.chat.completions.create(
				{
					model,
					messages: toOpenAIMessages(request.messages),
					temperature: request.temperature,
					max_tokens: request.maxTokens,
					response_format: responseFormat as unknown as Parameters<
						typeof client.chat.completions.create
					>[0]['response_format'],
				},
				{ signal: request.signal },
			);

			const text = response.choices[0]?.message?.content ?? '{}';
			const parsed = JSON.parse(text);
			const json = request.schema ? request.schema.parse(parsed) : parsed;

			return {
				json,
				text,
				model,
				provider: providerName,
				raw: response,
				usage: {
					inputTokens: response.usage?.prompt_tokens,
					outputTokens: response.usage?.completion_tokens,
					totalTokens: response.usage?.total_tokens,
				},
			};
		},

		async tool(request) {
			const client = await getClient();
			const model = request.model ?? getDefaultModel();

			const tools = request.tools.map((t) => ({
				type: 'function' as const,
				function: {
					name: t.name,
					description: t.description,
					parameters: t.parameters ?? { type: 'object', properties: {} },
				},
			}));

			const response = await client.chat.completions.create(
				{
					model,
					messages: toOpenAIMessages(request.messages),
					temperature: request.temperature,
					max_tokens: request.maxTokens,
					tools,
					tool_choice: 'auto',
				},
				{ signal: request.signal },
			);

			const message = response.choices[0]?.message;
			const toolCalls: ToolCall[] =
				message?.tool_calls
					?.filter(
						(tc): tc is typeof tc & { type: 'function'; function: { name: string; arguments: string } } =>
							tc.type === 'function',
					)
					.map((tc) => ({
						id: tc.id,
						name: tc.function.name,
						arguments: JSON.parse(tc.function.arguments) as Record<string, unknown>,
					})) ?? [];

			return {
				text: message?.content ?? '',
				model,
				provider: providerName,
				raw: response,
				toolCalls,
				finishReason: response.choices[0]?.finish_reason === 'tool_calls' ? 'tool_calls' : 'stop',
				usage: {
					inputTokens: response.usage?.prompt_tokens,
					outputTokens: response.usage?.completion_tokens,
					totalTokens: response.usage?.total_tokens,
				},
			};
		},
	};
}

export function toOpenAIMessages(messages: LLMMessage[]) {
	return messages.map((msg) => {
		if (msg.role === 'tool') {
			return { role: 'tool' as const, content: msg.content, tool_call_id: msg.toolCallId ?? '' };
		}
		if (msg.role === 'assistant' && msg.toolCalls?.length) {
			return {
				role: 'assistant' as const,
				content: msg.content || null,
				tool_calls: msg.toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function' as const,
					function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
				})),
			};
		}
		return { role: msg.role as 'system' | 'user' | 'assistant', content: msg.content };
		// biome-ignore lint/suspicious/noExplicitAny: OpenAI v6 message union is too strict to satisfy without any
	}) as any[];
}
