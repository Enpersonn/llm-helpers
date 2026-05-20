import assert from 'node:assert/strict';
import test from 'node:test';
import type { ToolBackend, ToolExecutionContext, ToolResult } from '../../types/src/tools.ts';
import createToolSystem from '../src/tool-system.ts';

const makeResult = (toolCallId: string, text: string): ToolResult => ({
	toolCallId,
	ok: true,
	content: [{ type: 'text', text }],
});

test('execute passes a derived signal and times out deterministically', async () => {
	let seenSignal: AbortSignal | undefined;

	const provider: ToolBackend = {
		id: 'slow-provider',
		listTools: async () => [{ name: 'slow_tool', inputSchema: { type: 'object' } }],
		callTool: async (call, context) => {
			seenSignal = context.signal;
			return await new Promise<ToolResult>((_, reject) => {
				context.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
					once: true,
				});
			});
		},
	};

	const toolSystem = createToolSystem({ providers: [provider], timeout: 10 });

	await assert.rejects(
		toolSystem.execute({ id: 'call_1', name: 'slow_tool', arguments: {} }, {} as ToolExecutionContext),
		/timed out after 10ms/,
	);
	assert.ok(seenSignal);
	assert.equal(seenSignal.aborted, true);
});

test('invalidate clears the registry cache and next listTools rebuilds it', async () => {
	let version = 1;
	let buildCount = 0;

	const provider: ToolBackend = {
		id: 'versioned',
		listTools: async () => {
			buildCount++;
			return [{ name: version === 1 ? 'tool_v1' : 'tool_v2', inputSchema: { type: 'object' } }];
		},
		callTool: async (call) => makeResult(call.id, 'ok'),
	};

	const toolSystem = createToolSystem({ providers: [provider] });
	const first = await toolSystem.listTools();
	assert.deepEqual(
		first.map((tool) => tool.name),
		['tool_v1'],
	);
	assert.equal(buildCount, 1);

	version = 2;
	toolSystem.invalidate();

	const second = await toolSystem.listTools();
	assert.deepEqual(
		second.map((tool) => tool.name),
		['tool_v2'],
	);
	assert.equal(buildCount, 2);
});

test('refresh rebuilds immediately and returns the refreshed tool list', async () => {
	let toolName = 'tool_v1';

	const provider: ToolBackend = {
		id: 'refreshable',
		listTools: async () => [{ name: toolName, inputSchema: { type: 'object' } }],
		callTool: async (call) => makeResult(call.id, 'ok'),
	};

	const toolSystem = createToolSystem({ providers: [provider] });
	await toolSystem.listTools();

	toolName = 'tool_v2';

	const refreshed = await toolSystem.refresh();
	assert.deepEqual(
		refreshed.map((tool) => tool.name),
		['tool_v2'],
	);
});

test('duplicate tool names fail fast during registry build', async () => {
	const providers: ToolBackend[] = [
		{
			id: 'provider-a',
			listTools: async () => [{ name: 'shared_tool', inputSchema: { type: 'object' } }],
			callTool: async (call) => makeResult(call.id, 'a'),
		},
		{
			id: 'provider-b',
			listTools: async () => [{ name: 'shared_tool', inputSchema: { type: 'object' } }],
			callTool: async (call) => makeResult(call.id, 'b'),
		},
	];

	const toolSystem = createToolSystem({ providers });

	await assert.rejects(toolSystem.listTools(), /provider-a/);
	await assert.rejects(toolSystem.listTools(), /provider-b/);
});

test('malformed tool definitions fail fast', async () => {
	const emptyNameProvider: ToolBackend = {
		id: 'empty-name',
		listTools: async () => [{ name: '   ', inputSchema: { type: 'object' } }],
		callTool: async (call) => makeResult(call.id, 'ok'),
	};

	const invalidSchemaProvider: ToolBackend = {
		id: 'bad-schema',
		listTools: async () => [{ name: 'broken_tool', inputSchema: 'nope' as unknown as Record<string, unknown> }],
		callTool: async (call) => makeResult(call.id, 'ok'),
	};

	await assert.rejects(createToolSystem({ providers: [emptyNameProvider] }).listTools(), /empty name/);
	await assert.rejects(createToolSystem({ providers: [invalidSchemaProvider] }).listTools(), /invalid inputSchema/);
});
