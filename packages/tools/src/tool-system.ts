import type { ToolBackend, ToolCall, ToolDefinition, ToolExecutionContext, ToolResult } from '@llm-helpers/types';
import type { Permissions } from './core/permissions.js';
import { createRegistry } from './core/registry.js';
import { withTimeout } from './core/timeout.js';

export type ToolSystemConfig = {
	providers: ToolBackend[];
	permissions?: Permissions;
	timeout?: number | ((toolName: string) => number);
};

export type ToolSystem = {
	listTools(): Promise<(ToolDefinition & { providerId: string })[]>;
	execute(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
};

export default function createToolSystem(config: ToolSystemConfig): ToolSystem {
	const registry = createRegistry(config.providers);

	const listTools = async () => {
		await registry.ensureBuilt();
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
		const work = provider.callTool(call, context);
		return timeoutMs !== undefined ? withTimeout(work, timeoutMs, call.name) : work;
	};

	return { listTools, execute };
}
