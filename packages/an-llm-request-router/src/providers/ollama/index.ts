import type {
	ChatProvider,
	EmbeddingBatchProvider,
	EmbeddingProvider,
	JsonProvider,
	LLMMessage,
	StreamingProvider,
	ToolCall,
	ToolProvider,
	VisionProvider,
} from '@llm-helpers/types';
import { adapterFactory } from '../../core/factory.js';
import { uint8ToBase64 } from '../util/image-converter.js';

type OllamaAdapter = ChatProvider &
	StreamingProvider &
	VisionProvider &
	EmbeddingProvider &
	EmbeddingBatchProvider &
	JsonProvider &
	ToolProvider;

export const ollama = adapterFactory('ollama', (config: { baseUrl?: string; model: string }): OllamaAdapter => {
	const baseUrl = config.baseUrl ?? 'http://localhost:11434';

	async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
		const res = await fetch(`${baseUrl}${path}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			signal,
			body: JSON.stringify(body),
		});
		if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
		return res.json() as Promise<T>;
	}

	return {
		capabilities: {
			nativeThinking: false,
			streaming: true,
			vision: true,
		},

		async chat(request) {
			const model = request.model ?? config.model;

			const data = await post<{
				message?: { content?: string };
				prompt_eval_count?: number;
				eval_count?: number;
			}>(
				'/api/chat',
				{
					model,
					messages: toOllamaMessages(request.messages),
					stream: false,
					options: { temperature: request.temperature, num_predict: request.maxTokens },
				},
				request.signal,
			);

			return {
				provider: 'ollama',
				model,
				text: data.message?.content ?? '',
				raw: data,
				usage: {
					inputTokens: data.prompt_eval_count,
					outputTokens: data.eval_count,
					totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) || undefined,
				},
			};
		},

		async *stream(request) {
			const model = request.model ?? config.model;

			const res = await fetch(`${baseUrl}/api/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				signal: request.signal,
				body: JSON.stringify({
					model,
					messages: toOllamaMessages(request.messages),
					stream: true,
					options: { temperature: request.temperature, num_predict: request.maxTokens },
				}),
			});

			if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
			if (!res.body) throw new Error('No response body from Ollama');

			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					if (!line.trim()) continue;
					const chunk = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
					const text = chunk.message?.content ?? '';
					if (text || chunk.done) yield { text, done: chunk.done, raw: chunk };
				}
			}
		},

		async vision(request) {
			const model = config.model;
			const base64 = uint8ToBase64(request.image);

			const data = await post<{ message?: { content?: string } }>('/api/chat', {
				model,
				messages: [{ role: 'user', content: request.prompt, images: [base64] }],
				stream: false,
			});

			return { text: data.message?.content ?? '', raw: data };
		},

		async embed(request) {
			const model = request.model ?? config.model;
			const data = await post<{ embeddings?: number[][] }>(
				'/api/embed',
				{ model, input: request.input },
				request.signal,
			);

			return { embedding: data.embeddings?.[0] ?? [], model, provider: 'ollama', raw: data };
		},

		async embedMany(request) {
			const model = request.model ?? config.model;
			const data = await post<{ embeddings?: number[][] }>(
				'/api/embed',
				{ model, input: request.input },
				request.signal,
			);

			return { embeddings: data.embeddings ?? [], model, provider: 'ollama', raw: data };
		},

		async json(request) {
			const model = request.model ?? config.model;

			let format: unknown = 'json';
			if (request.schema) {
				const { z } = await import('zod');
				format = z.toJSONSchema(request.schema);
			}

			const data = await post<{
				message?: { content?: string };
				prompt_eval_count?: number;
				eval_count?: number;
			}>(
				'/api/chat',
				{
					model,
					messages: toOllamaMessages(request.messages),
					stream: false,
					format,
					options: { temperature: request.temperature, num_predict: request.maxTokens },
				},
				request.signal,
			);

			const text = data.message?.content ?? '{}';
			const parsed = JSON.parse(text);
			const json = request.schema ? request.schema.parse(parsed) : parsed;

			return {
				json,
				text,
				model,
				provider: 'ollama',
				raw: data,
				usage: {
					inputTokens: data.prompt_eval_count,
					outputTokens: data.eval_count,
					totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) || undefined,
				},
			};
		},

		async tool(request) {
			const model = request.model ?? config.model;

			const tools = request.tools.map((t) => ({
				type: 'function' as const,
				function: {
					name: t.name,
					description: t.description,
					parameters: t.inputSchema ?? { type: 'object', properties: {} },
				},
			}));

			const data = await post<{
				message?: {
					content?: string;
					tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
				};
				done_reason?: string;
				prompt_eval_count?: number;
				eval_count?: number;
			}>(
				'/api/chat',
				{
					model,
					messages: toOllamaMessages(request.messages),
					stream: false,
					tools,
					options: { temperature: request.temperature, num_predict: request.maxTokens },
				},
				request.signal,
			);

			const toolCalls: ToolCall[] =
				data.message?.tool_calls?.map((tc, i) => ({
					id: `call_${i}`,
					name: tc.function.name,
					arguments: tc.function.arguments,
				})) ?? [];

			return {
				text: data.message?.content ?? '',
				model,
				provider: 'ollama',
				raw: data,
				toolCalls,
				finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
				usage: {
					inputTokens: data.prompt_eval_count,
					outputTokens: data.eval_count,
					totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0) || undefined,
				},
			};
		},
	};
});

function toOllamaMessages(messages: LLMMessage[]) {
	return messages.map((msg) => {
		if (msg.role === 'assistant' && msg.toolCalls?.length) {
			return {
				role: 'assistant',
				content: msg.content,
				tool_calls: msg.toolCalls.map((tc) => ({
					function: { name: tc.name, arguments: tc.arguments },
				})),
			};
		}
		return { role: msg.role, content: msg.content };
	});
}
