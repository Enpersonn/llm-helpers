import type { ToolBackend, ToolContent } from '@llm-helpers/types';

export type McpTool = {
	serverName: string;
	name: string;
	description?: string;
	inputSchema?: unknown;
};

export type McpCallResult = {
	content?: unknown[];
	isError?: boolean;
};

export type McpRuntime = {
	listTools(): Promise<McpTool[]>;
	callTool(params: {
		serverName: string;
		name: string;
		arguments: Record<string, unknown>;
		options?: { signal?: AbortSignal };
	}): Promise<McpCallResult>;
};

const parseMcpToolName = (name: string): { serverName: string; toolName: string } => {
	const parts = name.split('.');
	return { serverName: parts[1] ?? '', toolName: parts.slice(2).join('.') };
};

const normalizeMcpContent = (content?: unknown[]): ToolContent[] => {
	if (!content?.length) return [];
	return content.flatMap((block): ToolContent[] => {
		if (typeof block !== 'object' || block === null) return [];
		const b = block as Record<string, unknown>;
		if (b.type === 'text' && typeof b.text === 'string') {
			return [{ type: 'text', text: b.text }];
		}
		if (b.type === 'image' && typeof b.data === 'string') {
			return [
				{ type: 'image', data: b.data, mimeType: typeof b.mimeType === 'string' ? b.mimeType : 'image/png' },
			];
		}
		return [{ type: 'json', value: block }];
	});
};

export const createMcpProvider = (runtime: McpRuntime): ToolBackend => ({
	id: 'mcp',
	listTools: async () => {
		const tools = await runtime.listTools();
		return tools.map((t) => ({
			name: `mcp.${t.serverName}.${t.name}`,
			description: t.description,
			inputSchema: t.inputSchema as Record<string, unknown> | undefined,
		}));
	},
	callTool: async (call, context) => {
		const { serverName, toolName } = parseMcpToolName(call.name);
		const result = await runtime.callTool({
			serverName,
			name: toolName,
			arguments: call.arguments,
			options: { signal: context.signal },
		});
		const content = normalizeMcpContent(result.content);
		return {
			toolCallId: call.id,
			ok: !result.isError,
			content,
			metadata: { provider: 'mcp', server: serverName },
			...(result.isError ? { error: { message: 'MCP tool returned an error', code: 'MCP_ERROR' } } : {}),
		};
	},
});
