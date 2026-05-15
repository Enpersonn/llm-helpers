import type {
	ChatProvider,
	JsonProvider,
	LLMMessage,
	StreamingProvider,
	ToolCall,
	ToolProvider,
	VisionProvider,
} from '@llm-helpers/types';
import { adapterFactory } from '../../core/factory.js';
import { uint8ToBase64 } from '../util/image-converter.js';

type AnthropicAdapter = ChatProvider & StreamingProvider & VisionProvider & JsonProvider & ToolProvider;

export const anthropic = adapterFactory('anthropic', (config: { apiKey: string; model: string }): AnthropicAdapter => {
	let sdk: import('@anthropic-ai/sdk').default | undefined;

	async function getClient() {
		if (sdk) return sdk;
		const Anthropic = await import('@anthropic-ai/sdk').then((mod) => mod.default);
		sdk = new Anthropic({ apiKey: config.apiKey });
		return sdk;
	}

	return {
		async chat(request) {
			const client = await getClient();
			const model = request.model ?? config.model;
			const { system, messages } = toAnthropicMessages(request.messages);

			const response = await client.messages.create(
				{
					model,
					max_tokens: request.maxTokens ?? 1024,
					temperature: request.temperature,
					...(system ? { system } : {}),
					messages,
				},
				{ signal: request.signal },
			);

			const text = extractText(response.content);

			return {
				text,
				model,
				provider: 'anthropic',
				raw: response,
				usage: {
					inputTokens: response.usage.input_tokens,
					outputTokens: response.usage.output_tokens,
					totalTokens: response.usage.input_tokens + response.usage.output_tokens,
				},
			};
		},

		async *stream(request) {
			const client = await getClient();
			const model = request.model ?? config.model;
			const { system, messages } = toAnthropicMessages(request.messages);

			const stream = client.messages.stream({
				model,
				max_tokens: request.maxTokens ?? 1024,
				temperature: request.temperature,
				...(system ? { system } : {}),
				messages,
			});

			for await (const event of stream) {
				if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
					yield { text: event.delta.text, done: false, raw: event };
				}
			}

			yield { text: '', done: true };
		},

		async vision(request) {
			const client = await getClient();
			const base64 = uint8ToBase64(request.image);

			const response = await client.messages.create({
				model: config.model,
				max_tokens: 1024,
				messages: [
					{
						role: 'user',
						content: [
							{ type: 'text', text: request.prompt },
							{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
						],
					},
				],
			});

			return { text: extractText(response.content), raw: response };
		},

		async json(request) {
			const client = await getClient();
			const model = request.model ?? config.model;
			const { system, messages } = toAnthropicMessages(request.messages);

			let toolSchema: Record<string, unknown>;
			if (request.schema) {
				const { z } = await import('zod');
				toolSchema = z.toJSONSchema(request.schema) as Record<string, unknown>;
			} else {
				toolSchema = { type: 'object', properties: {} };
			}

			const response = await client.messages.create(
				{
					model,
					max_tokens: request.maxTokens ?? 1024,
					temperature: request.temperature,
					...(system ? { system } : {}),
					messages,
					tools: [
						{
							name: 'respond_as_json',
							description: 'Respond with structured JSON output.',
							// biome-ignore lint/suspicious/noExplicitAny: SDK input_schema type is opaque
							input_schema: toolSchema as any,
						},
					],
					tool_choice: { type: 'tool', name: 'respond_as_json' },
				},
				{ signal: request.signal },
			);

			const toolUse = response.content.find((b) => b.type === 'tool_use');
			// biome-ignore lint/suspicious/noExplicitAny: ToolUseBlock.input is typed as `unknown`
			const raw = (toolUse as any)?.input ?? {};
			// biome-ignore lint/suspicious/noExplicitAny: schema.parse result is correctly typed at call sites
			const json = (request.schema ? request.schema.parse(raw) : raw) as any;
			const text = JSON.stringify(json);

			return {
				json,
				text,
				model,
				provider: 'anthropic',
				raw: response,
				usage: {
					inputTokens: response.usage.input_tokens,
					outputTokens: response.usage.output_tokens,
					totalTokens: response.usage.input_tokens + response.usage.output_tokens,
				},
			};
		},

		async tool(request) {
			const client = await getClient();
			const model = request.model ?? config.model;
			const { system, messages } = toAnthropicMessages(request.messages);

			const tools = request.tools.map((t) => ({
				name: t.name,
				description: t.description ?? '',
				// biome-ignore lint/suspicious/noExplicitAny: SDK input_schema type is opaque
				input_schema: (t.parameters ?? { type: 'object', properties: {} }) as any,
			}));

			const response = await client.messages.create(
				{
					model,
					max_tokens: request.maxTokens ?? 1024,
					temperature: request.temperature,
					...(system ? { system } : {}),
					messages,
					tools,
				},
				{ signal: request.signal },
			);

			const toolCalls: ToolCall[] = response.content
				.filter((b) => b.type === 'tool_use')
				.map((b, i) => {
					// biome-ignore lint/suspicious/noExplicitAny: ContentBlock narrowed by type guard above
					const tu = b as any;
					return { id: tu.id ?? `call_${i}`, name: tu.name, arguments: tu.input as Record<string, unknown> };
				});

			return {
				text: extractText(response.content),
				model,
				provider: 'anthropic',
				raw: response,
				toolCalls,
				finishReason: toolCalls.length > 0 ? 'tool_calls' : 'stop',
				usage: {
					inputTokens: response.usage.input_tokens,
					outputTokens: response.usage.output_tokens,
					totalTokens: response.usage.input_tokens + response.usage.output_tokens,
				},
			};
		},
	};
});

// biome-ignore lint/suspicious/noExplicitAny: ContentBlock union is too broad to narrow without any
function extractText(content: any[]): string {
	return content
		.filter((b) => b.type === 'text')
		.map((b) => b.text as string)
		.join('');
}

// biome-ignore lint/suspicious/noExplicitAny: Anthropic MessageParam union is complex
function toAnthropicMessages(messages: LLMMessage[]): { system: string | undefined; messages: any[] } {
	const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
	const system = systemParts.length ? systemParts.join('\n') : undefined;

	const anthropicMessages = messages
		.filter((m) => m.role !== 'system')
		.map((msg) => {
			if (msg.role === 'tool') {
				return {
					role: 'user',
					content: [{ type: 'tool_result', tool_use_id: msg.toolCallId ?? '', content: msg.content }],
				};
			}
			if (msg.role === 'assistant' && msg.toolCalls?.length) {
				return {
					role: 'assistant',
					content: [
						...(msg.content ? [{ type: 'text', text: msg.content }] : []),
						...msg.toolCalls.map((tc) => ({
							type: 'tool_use',
							id: tc.id,
							name: tc.name,
							input: tc.arguments,
						})),
					],
				};
			}
			return { role: msg.role, content: msg.content };
		});

	return { system, messages: anthropicMessages };
}
