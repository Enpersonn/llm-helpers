import assert from 'node:assert/strict';
import test from 'node:test';
import type { LLMToolResponse, ToolProvider } from '../../types/src/index.ts';
import createAgent from '../src/core/agent.ts';
import type { AgentEventMap } from '../src/core/bus.ts';

const makeProvider = (responses: LLMToolResponse[]): ToolProvider => {
	let index = 0;

	return {
		capabilities: { nativeThinking: false, streaming: false, vision: false },
		tool: async () => {
			const response = responses[index] ?? responses[responses.length - 1];
			index++;
			return response;
		},
	};
};

test('failed tool discovery does not leave the agent stuck in a running state', async () => {
	let shouldFail = true;

	const toolSystem = {
		listTools: async () => {
			if (shouldFail) {
				shouldFail = false;
				throw new Error('tool discovery failed');
			}
			return [];
		},
		execute: async () => {
			throw new Error('should not execute');
		},
		invalidate: () => undefined,
		refresh: async () => [],
	};

	const agent = createAgent(
		makeProvider([{ text: 'done', provider: 'fake', toolCalls: [], finishReason: 'stop' }]),
		toolSystem,
	);

	await assert.rejects(agent.start({ messages: [{ role: 'user', content: 'hello' }] }), /tool discovery failed/);

	const context = await agent.start({ messages: [{ role: 'user', content: 'hello again' }] });
	assert.equal(context.at(-1)?.content, 'done');
});

test('tool_result emits both a string summary and the full ToolResult and keeps toolContent in context', async () => {
	const toolSystem = {
		listTools: async () => [
			{ name: 'lookup', description: 'lookup data', inputSchema: { type: 'object' }, providerId: 'fake' },
		],
		execute: async () => ({
			toolCallId: 'call_1',
			ok: true,
			content: [
				{ type: 'json' as const, value: { answer: 42 } },
				{ type: 'file' as const, path: '/tmp/report.txt', mimeType: 'text/plain' },
			],
			metadata: { source: 'fake' },
		}),
		invalidate: () => undefined,
		refresh: async () => [],
	};

	const agent = createAgent(
		makeProvider([
			{
				text: 'Let me check.',
				provider: 'fake',
				toolCalls: [{ id: 'call_1', name: 'lookup', arguments: { query: 'status' } }],
				finishReason: 'tool_calls',
			},
			{ text: 'Done.', provider: 'fake', toolCalls: [], finishReason: 'stop' },
		]),
		toolSystem,
	);

	const events: AgentEventMap['tool_result'][] = [];
	agent.bus.on('tool_result', (event) => events.push(event));

	const context = await agent.start({ messages: [{ role: 'user', content: 'status?' }] });

	assert.equal(events.length, 1);
	assert.equal(events[0]?.result, '{"answer":42}\n[file /tmp/report.txt (text/plain)]');
	assert.deepEqual(events[0]?.toolResult.content, [
		{ type: 'json', value: { answer: 42 } },
		{ type: 'file', path: '/tmp/report.txt', mimeType: 'text/plain' },
	]);

	const toolMessage = context.find((message) => message.role === 'tool');
	assert.deepEqual(toolMessage?.toolContent, events[0]?.toolResult.content);
	assert.equal(toolMessage?.content, events[0]?.result);
});

test('direct tools synthesize ToolResult payloads and preserve toolContent', async () => {
	const agent = createAgent(
		makeProvider([
			{
				text: '',
				provider: 'fake',
				toolCalls: [{ id: 'call_1', name: 'lookup', arguments: {} }],
				finishReason: 'tool_calls',
			},
			{ text: 'Done.', provider: 'fake', toolCalls: [], finishReason: 'stop' },
		]),
		[
			{
				def: { name: 'lookup', description: 'lookup data', inputSchema: { type: 'object' } },
				call: async () => ({ answer: 7 }),
			},
		],
	);

	let eventPayload: AgentEventMap['tool_result'] | undefined;

	agent.bus.on('tool_result', (event) => {
		eventPayload = event;
	});

	const context = await agent.start({ messages: [{ role: 'user', content: 'status?' }] });

	assert.equal(eventPayload?.result, '{"answer":7}');
	assert.deepEqual(eventPayload?.toolResult.content, [{ type: 'json', value: { answer: 7 } }]);

	const toolMessage = context.find((message) => message.role === 'tool');
	assert.deepEqual(toolMessage?.toolContent, [{ type: 'json', value: { answer: 7 } }]);
});
