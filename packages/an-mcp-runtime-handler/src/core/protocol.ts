import type {
	InitializeParams,
	JsonRpcMessage,
	McpClientCapabilities,
	McpClientHandlers,
	McpCompletionRef,
	McpLogLevel,
} from '../types.js';

const MCP_PROTOCOL_VERSION = '2025-11-25';

let _nextId = 1;
export const nextRequestId = (): string => String(_nextId++);

export const buildInitializeRequest = (id: string | number, params: InitializeParams): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'initialize',
	params: {
		protocolVersion: params.protocolVersion,
		clientInfo: params.clientInfo,
		capabilities: params.capabilities,
	},
});

export const buildInitializedNotification = (): JsonRpcMessage => ({
	jsonrpc: '2.0',
	method: 'notifications/initialized',
});

export const buildPingRequest = (id: string | number): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'ping',
});

export const buildPongResponse = (id: string | number): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	result: {},
});

export const buildToolsListRequest = (
	id: string | number,
	cursor?: string,
	progressToken?: string | number,
): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'tools/list',
	params: {
		...(cursor !== undefined ? { cursor } : {}),
		...(progressToken !== undefined ? { _meta: { progressToken } } : {}),
	},
});

export const buildToolCallRequest = (
	id: string | number,
	name: string,
	args: Record<string, unknown>,
	meta?: { progressToken?: string | number; task?: { ttl?: number } },
): JsonRpcMessage => {
	const _meta: Record<string, unknown> = {};
	if (meta?.progressToken !== undefined) _meta.progressToken = meta.progressToken;
	if (meta?.task !== undefined) _meta.task = meta.task;

	return {
		jsonrpc: '2.0',
		id,
		method: 'tools/call',
		params: {
			name,
			arguments: args,
			...(Object.keys(_meta).length > 0 ? { _meta } : {}),
		},
	};
};

export const buildLoggingSetLevelRequest = (id: string | number, level: McpLogLevel): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'logging/setLevel',
	params: { level },
});

export const buildCompletionRequest = (
	id: string | number,
	ref: McpCompletionRef,
	argument: { name: string; value: string },
	context?: { arguments?: Record<string, string> },
): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'completion/complete',
	params: {
		ref,
		argument,
		...(context !== undefined ? { context } : {}),
	},
});

export const buildTasksListRequest = (id: string | number): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'tasks/list',
});

export const buildTasksGetRequest = (id: string | number, taskId: string): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'tasks/get',
	params: { id: taskId },
});

export const buildTasksResultRequest = (id: string | number, taskId: string): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'tasks/result',
	params: { id: taskId },
});

export const buildTasksCancelRequest = (id: string | number, taskId: string): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	method: 'tasks/cancel',
	params: { id: taskId },
});

export const buildCancelNotification = (requestId: string | number, reason?: string): JsonRpcMessage => ({
	jsonrpc: '2.0',
	method: 'notifications/cancelled',
	params: {
		requestId,
		...(reason !== undefined ? { reason } : {}),
	},
});

export const buildRootsChangedNotification = (): JsonRpcMessage => ({
	jsonrpc: '2.0',
	method: 'notifications/roots/list_changed',
});

export const buildErrorResponse = (
	id: string | number,
	code: number,
	message: string,
	data?: unknown,
): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	error: {
		code,
		message,
		...(data !== undefined ? { data } : {}),
	},
});

export const buildSuccessResponse = (id: string | number, result: unknown): JsonRpcMessage => ({
	jsonrpc: '2.0',
	id,
	result,
});

export const buildDefaultClientInfo = (): InitializeParams['clientInfo'] => ({
	name: '@llm-helpers/an-mcp-runtime-handler',
	version: '1.0.0',
});

export const buildInitializeParams = (
	capabilities: McpClientCapabilities,
	clientInfo?: Partial<InitializeParams['clientInfo']>,
): InitializeParams => ({
	protocolVersion: MCP_PROTOCOL_VERSION,
	clientInfo: {
		...buildDefaultClientInfo(),
		...clientInfo,
	},
	capabilities,
});

export const deriveClientCapabilities = (
	handlers: McpClientHandlers,
	overrides?: McpClientCapabilities,
): McpClientCapabilities => {
	const caps: McpClientCapabilities = {};

	if (handlers.onRootsList) {
		caps.roots = { listChanged: true };
	}
	if (handlers.onSampling) {
		caps.sampling = {};
	}
	if (handlers.onElicitation || handlers.onUrlElicitation) {
		caps.elicitation = {};
		if (handlers.onElicitation) caps.elicitation.form = {};
		if (handlers.onUrlElicitation) caps.elicitation.url = {};
	}

	return { ...caps, ...overrides };
};

export { MCP_PROTOCOL_VERSION };
