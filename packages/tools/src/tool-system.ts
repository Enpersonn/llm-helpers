import { buildCombinedSignal, withTimeout } from '@llm-helpers/core';
import type { ToolBackend, ToolCall, ToolDefinition, ToolExecutionContext, ToolResult } from '@llm-helpers/types';
import type { Permissions } from './core/permissions.js';
import { createRegistry } from './core/registry.js';

export type ToolSystemConfig = {
	providers: ToolBackend[];
	permissions?: Permissions;
	timeout?: number | ((toolName: string) => number);
};

export type ToolSystem = {
	listTools(): Promise<(ToolDefinition & { providerId: string })[]>;
	invalidate(): void;
	refresh(): Promise<(ToolDefinition & { providerId: string })[]>;
	execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
};

const isAbortError = (error: unknown): boolean =>
	error instanceof DOMException
		? error.name === 'AbortError'
		: error instanceof Error
			? error.name === 'AbortError'
			: false;

const isTimeoutReason = (signal?: AbortSignal): boolean =>
	signal?.aborted === true && signal.reason instanceof DOMException && signal.reason.name === 'TimeoutError';

export default function createToolSystem(config: ToolSystemConfig): ToolSystem {
	const registry = createRegistry(config.providers);

	const listTools = async () => {
		await registry.ensureBuilt();
		return registry.listAll();
	};

	const invalidate = () => {
		registry.invalidate();
	};

	const refresh = async () => {
		await registry.refresh();
		return registry.listAll();
	};

	const execute = async (call: ToolCall, context: ToolExecutionContext): Promise<ToolResult> => {
		if (config.permissions) {
			const decision = config.permissions.check(call, context);
			if (decision.type === 'deny') {
				return {
					toolCallId: call.id,
					ok: false,
					content: [],
					error: { message: decision.reason ?? `Tool '${call.name}' denied`, code: 'PERMISSION_DENIED' },
				};
			}
			if (decision.type === 'ask') {
				const approved = (await context.requestApproval?.(decision.message)) ?? false;
				if (!approved) {
					return {
						toolCallId: call.id,
						ok: false,
						content: [],
						error: { message: `Tool '${call.name}' was not approved`, code: 'PERMISSION_DENIED' },
					};
				}
			}
		}

		await registry.ensureBuilt();
		const provider = registry.getProvider(call.name);

		if (!provider) {
			return {
				toolCallId: call.id,
				ok: false,
				content: [],
				error: { message: `Unknown tool: ${call.name}`, code: 'TOOL_NOT_FOUND' },
			};
		}

		const timeoutMs = typeof config.timeout === 'function' ? config.timeout(call.name) : config.timeout;
		const executionSignal = buildCombinedSignal(context.signal, timeoutMs);
		const executionContext = { ...context, signal: executionSignal };
		const work = provider.callTool(call, executionContext).catch((error: unknown) => {
			if (timeoutMs !== undefined && isTimeoutReason(executionSignal) && isAbortError(error)) {
				throw new Error(`Tool '${call.name}' timed out after ${timeoutMs}ms`);
			}
			throw error;
		});
		return timeoutMs !== undefined ? withTimeout(work, timeoutMs, call.name) : work;
	};

	return { listTools, invalidate, refresh, execute };
}
