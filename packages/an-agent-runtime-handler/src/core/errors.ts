import type { LLMMessage } from '@llm-helpers/types';

export class AgentError extends Error {
	constructor(
		message: string,
		public readonly context: LLMMessage[],
	) {
		super(message);
		this.name = 'AgentError';
	}
}

export class AgentStepLimitError extends AgentError {
	constructor(
		public readonly maxSteps: number,
		context: LLMMessage[],
	) {
		super(`Agent exceeded max steps (${maxSteps})`, context);
		this.name = 'AgentStepLimitError';
	}
}

export class AgentAbortError extends AgentError {
	constructor(
		public readonly reason: 'signal' | 'timeout' | 'stop',
		context: LLMMessage[],
	) {
		super(`Agent aborted: ${reason}`, context);
		this.name = 'AgentAbortError';
	}
}

export class AgentContextLimitError extends AgentError {
	constructor(
		public readonly maxMessages: number,
		context: LLMMessage[],
	) {
		super(`Agent context exceeded ${maxMessages} messages`, context);
		this.name = 'AgentContextLimitError';
	}
}
