import type {
	ChatProvider,
	EmbeddingBatchProvider,
	EmbeddingProvider,
	JsonProvider,
	LLMMessage,
	StreamingProvider,
	ToolCall,
	ToolProvider,
} from '@llm-helpers/types';
import { adapterFactory } from '../../core/factory.js';

type CohereAdapter = ChatProvider &
	StreamingProvider &
	EmbeddingProvider &
	EmbeddingBatchProvider &
	JsonProvider &
	ToolProvider;

export const cohere = adapterFactory('cohere', (config: { apiKey: string; model: string }): CohereAdapter => {
	let co: import('cohere-ai').CohereClientV2 | undefined;

	async function getClient() {
		if (co) return co;
		const { CohereClientV2 } = await import('cohere-ai');
		co = new CohereClientV2({ token: config.apiKey });
		return co;
	}

	return {
		capabilities: {
			nativeThinking: false,
			streaming: true,
			vision: false,
		},

		async chat(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const response = await co.chat({
				model,
				messages: toCohereMessages(request.messages),
				...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
			});

			const content = response.message?.content ?? [];
			const text = content
				.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('');

			return {
				text,
				model,
				provider: 'cohere',
				raw: response,
				usage: {
					inputTokens: response.usage?.tokens?.inputTokens,
					outputTokens: response.usage?.tokens?.outputTokens,
					totalTokens:
						(response.usage?.tokens?.inputTokens ?? 0) + (response.usage?.tokens?.outputTokens ?? 0) ||
						undefined,
				},
			};
		},

		async *stream(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const stream = await co.chatStream({
				model,
				messages: toCohereMessages(request.messages),
				...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
			});

			for await (const event of stream) {
				if (event.type === 'content-delta') {
					const text = event.delta?.message?.content?.text ?? '';
					yield { text, done: false, raw: event };
				}
			}

			yield { text: '', done: true };
		},

		async embed(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const response = await co.embed({
				model,
				texts: [request.input],
				inputType: 'search_document',
				embeddingTypes: ['float'],
			});

			const floats = (response.embeddings as { float?: number[][] } | undefined)?.float;

			return {
				embedding: floats?.[0] ?? [],
				model,
				provider: 'cohere',
				raw: response,
			};
		},

		async embedMany(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const response = await co.embed({
				model,
				texts: request.input,
				inputType: 'search_document',
				embeddingTypes: ['float'],
			});

			const floats = (response.embeddings as { float?: number[][] } | undefined)?.float;

			return {
				embeddings: floats ?? [],
				model,
				provider: 'cohere',
				raw: response,
			};
		},

		async json(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const messages = toCohereMessages(request.messages);
			const jsonInstruction = 'Respond with valid JSON only. Do not include markdown or code fences.';
			const sysIdx = messages.findIndex((m) => m.role === 'system');
			if (sysIdx >= 0) {
				const sys = messages[sysIdx] as { role: string; content: string };
				messages[sysIdx] = { ...sys, content: `${sys.content}\n${jsonInstruction}` };
			} else {
				messages.unshift({ role: 'system', content: jsonInstruction });
			}

			const response = await co.chat({
				model,
				messages,
				...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
			});

			const content = response.message?.content ?? [];
			const text =
				content
					.filter((c) => c.type === 'text')
					.map((c) => c.text)
					.join('') || '{}';
			const parsed = JSON.parse(text);
			// biome-ignore lint/suspicious/noExplicitAny: schema.parse result is correctly typed at call sites
			const json = (request.schema ? request.schema.parse(parsed) : parsed) as any;

			return {
				json,
				text,
				model,
				provider: 'cohere',
				raw: response,
				usage: {
					inputTokens: response.usage?.tokens?.inputTokens,
					outputTokens: response.usage?.tokens?.outputTokens,
					totalTokens:
						(response.usage?.tokens?.inputTokens ?? 0) + (response.usage?.tokens?.outputTokens ?? 0) ||
						undefined,
				},
			};
		},

		async tool(request) {
			const co = await getClient();
			const model = request.model ?? config.model;

			const tools = request.tools.map((t) => ({
				type: 'function' as const,
				function: {
					name: t.name,
					description: t.description ?? '',
					parameters: t.inputSchema ?? { type: 'object', properties: {} },
				},
			}));

			const response = await co.chat({
				model,
				messages: toCohereMessages(request.messages),
				tools,
				...(request.maxTokens ? { maxTokens: request.maxTokens } : {}),
				...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
			});

			const rawToolCalls = response.message?.toolCalls ?? [];
			const toolCalls: ToolCall[] = rawToolCalls
				.filter(
					(tc): tc is typeof tc & { function: { name: string; arguments?: string } } => !!tc.function?.name,
				)
				.map((tc, i) => ({
					id: tc.id ?? `call_${i}`,
					name: tc.function.name,
					arguments: tc.function.arguments
						? (JSON.parse(tc.function.arguments) as Record<string, unknown>)
						: {},
				}));

			const content = response.message?.content ?? [];
			const text = content
				.filter((c) => c.type === 'text')
				.map((c) => c.text)
				.join('');

			return {
				text,
				model,
				provider: 'cohere',
				raw: response,
				toolCalls,
				finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
				usage: {
					inputTokens: response.usage?.tokens?.inputTokens,
					outputTokens: response.usage?.tokens?.outputTokens,
					totalTokens:
						(response.usage?.tokens?.inputTokens ?? 0) + (response.usage?.tokens?.outputTokens ?? 0) ||
						undefined,
				},
			};
		},
	};
});

// biome-ignore lint/suspicious/noExplicitAny: Cohere v2 message union types are complex to satisfy without any
function toCohereMessages(messages: LLMMessage[]): any[] {
	return messages.map((msg) => {
		if (msg.role === 'tool') {
			return {
				role: 'tool',
				toolCallId: msg.toolCallId ?? '',
				content: [{ type: 'text', text: msg.content }],
			};
		}
		if (msg.role === 'assistant' && msg.toolCalls?.length) {
			return {
				role: 'assistant',
				toolCalls: msg.toolCalls.map((tc) => ({
					id: tc.id,
					type: 'function',
					function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
				})),
				...(msg.content ? { content: [{ type: 'text', text: msg.content }] } : {}),
			};
		}
		return { role: msg.role, content: msg.content };
	});
}
