import { adapterFactory } from '../../core/factory.js';
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
import { uint8ToBase64 } from '../util/image-converter.js';

type GeminiAdapter = ChatProvider &
	StreamingProvider &
	VisionProvider &
	EmbeddingProvider &
	EmbeddingBatchProvider &
	JsonProvider &
	ToolProvider;

export const gemini = adapterFactory('gemini', (config: { apiKey: string; model: string }): GeminiAdapter => {
	let ai: import('@google/genai').GoogleGenAI | undefined;

	async function getClient() {
		if (ai) return ai;
		const { GoogleGenAI } = await import('@google/genai');
		ai = new GoogleGenAI({ apiKey: config.apiKey });
		return ai;
	}

	return {
		async chat(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;
			const systemInstruction = extractSystemInstruction(request.messages);

			const response = await ai.models.generateContent({
				model,
				contents: toGeminiContents(request.messages),
				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					...(systemInstruction ? { systemInstruction } : {}),
				},
			});

			return {
				text: response.text ?? '',
				model,
				provider: 'gemini',
				raw: response,
				usage: {
					inputTokens: response.usageMetadata?.promptTokenCount,
					outputTokens: response.usageMetadata?.candidatesTokenCount,
					totalTokens: response.usageMetadata?.totalTokenCount,
				},
			};
		},

		async *stream(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;
			const systemInstruction = extractSystemInstruction(request.messages);

			const response = await ai.models.generateContentStream({
				model,
				contents: toGeminiContents(request.messages),
				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					...(systemInstruction ? { systemInstruction } : {}),
				},
			});

			for await (const chunk of response) {
				yield { text: chunk.text ?? '', done: false, raw: chunk };
			}

			yield { text: '', done: true };
		},

		async vision(request) {
			const ai = await getClient();
			const base64 = uint8ToBase64(request.image);

			const response = await ai.models.generateContent({
				model: config.model,
				contents: [
					{
						role: 'user',
						parts: [{ text: request.prompt }, { inlineData: { mimeType: 'image/jpeg', data: base64 } }],
					},
				],
			});

			return { text: response.text ?? '', raw: response };
		},

		async embed(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;

			const response = await ai.models.embedContent({
				model,
				contents: request.input,
				config: { abortSignal: request.signal },
			});

			return {
				embedding: response.embeddings?.[0]?.values ?? [],
				model,
				provider: 'gemini',
				raw: response,
			};
		},

		async embedMany(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;

			const responses = await Promise.all(
				request.input.map((text) =>
					ai.models.embedContent({
						model,
						contents: text,
						config: { abortSignal: request.signal },
					}),
				),
			);

			return {
				embeddings: responses.map((r) => r.embeddings?.[0]?.values ?? []),
				model,
				provider: 'gemini',
				raw: responses,
			};
		},

		async json(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;
			const systemInstruction = extractSystemInstruction(request.messages);

			let responseSchema: unknown;
			if (request.schema) {
				const { z } = await import('zod');
				responseSchema = z.toJSONSchema(request.schema);
			}

			const response = await ai.models.generateContent({
				model,
				contents: toGeminiContents(request.messages),
				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					responseMimeType: 'application/json',
					...(systemInstruction ? { systemInstruction } : {}),
					...(responseSchema ? { responseSchema } : {}),
				},
			});

			const text = response.text ?? '{}';
			const parsed = JSON.parse(text);
			const json = request.schema ? request.schema.parse(parsed) : parsed;

			return {
				json,
				text,
				model,
				provider: 'gemini',
				raw: response,
				usage: {
					inputTokens: response.usageMetadata?.promptTokenCount,
					outputTokens: response.usageMetadata?.candidatesTokenCount,
					totalTokens: response.usageMetadata?.totalTokenCount,
				},
			};
		},

		async tool(request) {
			const ai = await getClient();
			const model = request.model ?? config.model;
			const systemInstruction = extractSystemInstruction(request.messages);

			const tools = [
				{
					functionDeclarations: request.tools.map((t) => ({
						name: t.name,
						description: t.description,
						parameters: t.parameters,
					})),
				},
			];

			const response = await ai.models.generateContent({
				model,
				contents: toGeminiContents(request.messages),
				config: {
					temperature: request.temperature,
					maxOutputTokens: request.maxTokens,
					abortSignal: request.signal,
					tools,
					...(systemInstruction ? { systemInstruction } : {}),
				},
			});

			const parts = response.candidates?.[0]?.content?.parts ?? [];
			const toolCalls: ToolCall[] = parts
				.filter(
					(p): p is typeof p & { functionCall: NonNullable<(typeof p)['functionCall']> } =>
						p.functionCall != null,
				)
				.map((p, i) => ({
					id: p.functionCall.id ?? `call_${i}`,
					name: p.functionCall.name ?? '',
					arguments: (p.functionCall.args ?? {}) as Record<string, unknown>,
				}));

			return {
				text: response.text ?? '',
				model,
				provider: 'gemini',
				raw: response,
				toolCalls,
				finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
				usage: {
					inputTokens: response.usageMetadata?.promptTokenCount,
					outputTokens: response.usageMetadata?.candidatesTokenCount,
					totalTokens: response.usageMetadata?.totalTokenCount,
				},
			};
		},
	};
});

function extractSystemInstruction(messages: LLMMessage[]): string | undefined {
	const parts = messages.filter((m) => m.role === 'system').map((m) => m.content);
	return parts.length ? parts.join('\n') : undefined;
}

function toGeminiContents(messages: LLMMessage[]) {
	return messages
		.filter((m) => m.role !== 'system')
		.map((message) => {
			if (message.role === 'tool') {
				return {
					role: 'user' as const,
					parts: [
						{
							functionResponse: {
								name: message.toolName ?? message.toolCallId ?? 'tool',
								response: { result: message.content },
							},
						},
					],
				};
			}
			if (message.role === 'assistant' && message.toolCalls?.length) {
				return {
					role: 'model' as const,
					parts: message.toolCalls.map((tc) => ({
						functionCall: { id: tc.id, name: tc.name, args: tc.arguments },
					})),
				};
			}
			return {
				role: message.role === 'assistant' ? ('model' as const) : ('user' as const),
				parts: [{ text: message.content }],
			};
		});
}
