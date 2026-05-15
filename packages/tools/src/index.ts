export type {
	ToolBackend,
	ToolCall,
	ToolContent,
	ToolDefinition,
	ToolExecutionContext,
	ToolResult,
} from '@llm-helpers/types';

export { createToolBackend } from './core/factory.js';
export type { PermissionDecision, PermissionRule, Permissions } from './core/permissions.js';
export { allow, ask, createPermissions, deny } from './core/permissions.js';
export type { FunctionTool } from './providers/function.js';
export { createFunctionProvider, defineTool } from './providers/function.js';
export type { McpCallResult, McpRuntime, McpTool } from './providers/mcp.js';
export { createMcpProvider } from './providers/mcp.js';
export type { ToolSystem, ToolSystemConfig } from './tool-system.js';
export { default as createToolSystem } from './tool-system.js';
