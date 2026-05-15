export type ToolDefinition = {
	name: string;
	description?: string;
	inputSchema?: Record<string, unknown>;
};

export type ToolCall = {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
};

export type ToolContent =
	| { type: 'text'; text: string }
	| { type: 'json'; value: unknown }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'file'; path: string; mimeType?: string };

export type ToolResult = {
	toolCallId: string;
	ok: boolean;
	content: ToolContent[];
	metadata?: Record<string, unknown>;
	error?: {
		message: string;
		code?: string;
	};
};

export type ToolExecutionContext = {
	sessionId?: string;
	cwd?: string;
	signal?: AbortSignal;
	requestApproval?: (message: string) => Promise<boolean>;
	metadata?: Record<string, unknown>;
};

export interface ToolBackend {
	id: string;
	listTools(): Promise<ToolDefinition[]>;
	callTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}
