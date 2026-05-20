import assert from 'node:assert/strict';
import test from 'node:test';
import { createLLM, adapterFactory } from '../src/index.ts';
import { toGeminiContents } from '../src/providers/gemini/index.ts';
import type { LLMToolRequest } from '../../types/src/index.ts';

test('createLLM validates the default provider and registered adapters', () => {
	assert.throws(
		() =>
			createLLM(
				{
					defaultProvider: 'missing',
					providers: {},
				} as never,
				{ adapters: {} },
			),
		/Default provider 'missing' is not configured/,
	);

	assert.throws(
		() =>
			createLLM(
				{
					defaultProvider: 'missing',
					providers: { missing: {} },
				} as never,
				{ adapters: {} },
			),
		/No adapter registered for provider 'missing'/,
	);
});

test('gemini content conversion preserves assistant text before tool calls', () => {
	const contents = toGeminiContents([
		{
			role: 'assistant',
			content: 'Need to call a tool first.',
			toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { city: 'Oslo' } }],
		},
	]);

	assert.equal(contents.length, 1);
	assert.deepEqual(contents[0], {
		role: 'model',
		parts: [
			{ text: 'Need to call a tool first.' },
			{ functionCall: { id: 'call_1', name: 'lookup', args: { city: 'Oslo' } } },
		],
	});
});

test('gemini content conversion prefers structured toolContent when available', () => {
	const contents = toGeminiContents([
		{
			role: 'tool',
			content: 'fallback',
			toolCallId: 'call_1',
			toolName: 'lookup',
			toolContent: [{ type: 'json', value: { answer: 42 } }],
		},
	]);

	assert.deepEqual(contents[0], {
		role: 'user',
		parts: [
			{
				functionResponse: {
					name: 'lookup',
					response: { result: { answer: 42 } },
				},
			},
		],
	});
});

test('tool requests use shared inputSchema naming', () => {
	const request: LLMToolRequest = {
		messages: [{ role: 'user', content: 'hello' }],
		tools: [{ name: 'lookup', inputSchema: { type: 'object', properties: {} } }],
	};

	assert.equal(request.tools[0]?.inputSchema?.type, 'object');
});

test('createLLM uses registered adapters after validation succeeds', async () => {
	const fake = adapterFactory('fake', (_config: { token: string }) => ({
		capabilities: { nativeThinking: false, streaming: false, vision: false },
		chat: async () => ({ text: 'ok', provider: 'fake' }),
	}));

	const llm = createLLM(
		{
			defaultProvider: 'fake',
			providers: { fake: { token: 'secret' } },
		},
		{ adapters: { fake } },
	);

	const response = await llm.default().chat({ messages: [{ role: 'user', content: 'hi' }] });
	assert.equal(response.text, 'ok');
});
