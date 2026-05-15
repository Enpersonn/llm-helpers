import type { LLMMessage, LLMToolRequest, LLMToolResponse } from '@llm-helpers/types';

export type RetryPolicy = {
	maxAttempts?: number;
	backoff?: (attempt: number, error: unknown) => number | false;
};

export type AgentHooks = {
	beforeLLMCall?: (req: LLMToolRequest) => LLMToolRequest | Promise<LLMToolRequest>;
	afterLLMCall?: (res: LLMToolResponse) => LLMToolResponse | Promise<LLMToolResponse>;
	beforeToolCall?: (
		toolName: string,
		args: Record<string, unknown>,
	) => Record<string, unknown> | Promise<Record<string, unknown>>;
	afterToolCall?: (toolName: string, result: string) => string | Promise<string>;
	onContextOverflow?: (messages: LLMMessage[]) => LLMMessage[] | Promise<LLMMessage[]>;
};

export type AgentOptions = {
	maxSteps?: number;
	timeout?: number;
	retry?: RetryPolicy;
	hooks?: AgentHooks;
	onToolError?: 'continue' | 'throw';
	maxContextMessages?: number;
	metadata?: Record<string, unknown>;
};
