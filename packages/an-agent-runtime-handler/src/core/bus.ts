import { type Bus, createBus } from '@llm-helpers/core';
import type { LLMMessage, LLMUsage, ToolResult } from '@llm-helpers/types';

export type { Bus };
export { createBus };

export type AgentEventMap = {
	thinking: { content: string; step: number; metadata?: Record<string, unknown> };
	tool_call: { toolName: string; args: Record<string, unknown>; step: number; metadata?: Record<string, unknown> };
	tool_result: {
		toolName: string;
		result: string;
		toolResult: ToolResult;
		step: number;
		metadata?: Record<string, unknown>;
	};
	tool_error: { toolName: string; error: unknown; step: number; metadata?: Record<string, unknown> };
	step_start: { step: number; metadata?: Record<string, unknown> };
	step_end: { step: number; usage?: LLMUsage; metadata?: Record<string, unknown> };
	retry: { step: number; attempt: number; error: unknown; delayMs: number; metadata?: Record<string, unknown> };
	complete: { finalMessage: LLMMessage; totalUsage: LLMUsage; metadata?: Record<string, unknown> };
	aborted: { reason: 'signal' | 'timeout' | 'stop'; metadata?: Record<string, unknown> };
	context_trim: { before: number; after: number; step: number; metadata?: Record<string, unknown> };
};
