import type { ToolBackend, ToolCall, ToolDefinition, ToolExecutionContext, ToolResult } from '@llm-helpers/types';

export const createToolBackend = (config: {
	id: string;
	listTools(): Promise<ToolDefinition[]>;
	callTool(call: ToolCall, context: ToolExecutionContext): Promise<ToolResult>;
}): ToolBackend => config;
