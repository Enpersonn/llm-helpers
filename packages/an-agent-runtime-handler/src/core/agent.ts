import type { ToolSystem } from '@llm-helpers/tools';
import type {
	LLMMessage,
	LLMRequest,
	LLMToolRequest,
	LLMToolResponse,
	LLMUsage,
	ToolDefinition,
	ToolProvider,
} from '@llm-helpers/types';
import { type AgentEventMap, type Bus, createBus } from './bus.js';
import { AgentAbortError, AgentContextLimitError, AgentStepLimitError } from './errors.js';
import type { AgentOptions } from './options.js';
import { accumulateUsage, buildCombinedSignal, callWithRetry } from './utils.js';

type ToolsList = {
	call: (args: Record<string, unknown>) => unknown | Promise<unknown>;
	def: ToolDefinition;
	parse?: (args: Record<string, unknown>) => Record<string, unknown>;
}[];

const isToolSystem = (tools: ToolsList | ToolSystem): tools is ToolSystem => !Array.isArray(tools);

const toolResultToString = (result: Awaited<ReturnType<ToolSystem['execute']>>): string => {
	if (!result.ok && result.error) return `Error: ${result.error.message}`;
	return result.content
		.map((c) => {
			if (c.type === 'text') return c.text;
			if (c.type === 'json') return JSON.stringify(c.value);
			return `[${c.type}]`;
		})
		.join('\n');
};

export default function createAgent(
	provider: ToolProvider,
	tools: ToolsList | ToolSystem,
	options: AgentOptions = {},
): {
	start: (request: LLMRequest) => Promise<LLMMessage[]>;
	stop: () => void;
	getContext: () => LLMMessage[];
	bus: Bus<AgentEventMap>;
} {
	const {
		maxSteps,
		timeout,
		retry = {},
		hooks = {},
		onToolError = 'continue',
		maxContextMessages,
		metadata,
	} = options;
	const bus = createBus<AgentEventMap>();

	let runController: AbortController | null = null;
	let agentContext: LLMMessage[] = [];

	const stop = () => {
		runController?.abort('stop');
	};

	const getContext = (): LLMMessage[] => [...agentContext];

	const start = async (request: LLMRequest): Promise<LLMMessage[]> => {
		if (runController !== null) throw new Error('Agent is already running');
		runController = new AbortController();
		const stopSignal = runController.signal;
		agentContext = [...request.messages];

		const callerSignal =
			request.signal && stopSignal
				? AbortSignal.any([request.signal, stopSignal])
				: (request.signal ?? stopSignal);
		const combinedSignal = buildCombinedSignal(callerSignal, timeout);

		const resolvedToolDefs: ToolDefinition[] = isToolSystem(tools)
			? await tools.listTools()
			: tools.map((t) => t.def);

		const totalUsage: LLMUsage = {};
		let step = 0;

		try {
			while (true) {
				if (combinedSignal?.aborted) {
					const reason: 'signal' | 'timeout' | 'stop' =
						combinedSignal.reason === 'stop'
							? 'stop'
							: combinedSignal.reason instanceof DOMException &&
									combinedSignal.reason.name === 'TimeoutError'
								? 'timeout'
								: 'signal';
					bus.emit('aborted', { reason, metadata });
					throw new AgentAbortError(reason, agentContext);
				}

				step++;

				if (maxSteps !== undefined && step > maxSteps) {
					throw new AgentStepLimitError(maxSteps, agentContext);
				}

				bus.emit('step_start', { step, metadata });

				let llmReq: LLMToolRequest = {
					...request,
					messages: agentContext,
					tools: resolvedToolDefs,
					signal: combinedSignal,
				};
				if (hooks.beforeLLMCall) llmReq = await hooks.beforeLLMCall(llmReq);

				let res: LLMToolResponse = await callWithRetry(
					() => provider.tool(llmReq),
					retry,
					step,
					(payload) => bus.emit('retry', { ...payload, metadata }),
				);
				if (hooks.afterLLMCall) res = await hooks.afterLLMCall(res);

				accumulateUsage(totalUsage, res.usage);
				bus.emit('step_end', { step, usage: res.usage, metadata });

				if (res.thinkingContent) {
					bus.emit('thinking', { content: res.thinkingContent, step, metadata });
				}

				agentContext.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls ?? [] });

				if (res.finishReason === 'stop') {
					bus.emit('complete', { finalMessage: agentContext[agentContext.length - 1], totalUsage, metadata });
					break;
				}

				const toolCalls = res.toolCalls ?? [];

				for (const toolCall of toolCalls) {
					let args = toolCall.arguments;
					if (hooks.beforeToolCall) args = await hooks.beforeToolCall(toolCall.name, args);

					let resultStr: string;
					try {
						if (isToolSystem(tools)) {
							bus.emit('tool_call', { toolName: toolCall.name, args, step, metadata });
							const result = await tools.execute(
								{ id: toolCall.id, name: toolCall.name, arguments: args },
								{ signal: combinedSignal },
							);
							resultStr = toolResultToString(result);
						} else {
							const tool = tools.find((t) => t.def.name === toolCall.name);
							if (!tool) {
								agentContext.push({
									role: 'tool',
									content: `Error: unknown tool '${toolCall.name}'`,
									toolCallId: toolCall.id,
									toolName: toolCall.name,
								});
								continue;
							}
							if (tool.parse) args = tool.parse(args);
							bus.emit('tool_call', { toolName: toolCall.name, args, step, metadata });
							const result = await tool.call(args);
							resultStr = typeof result === 'string' ? result : JSON.stringify(result);
						}
					} catch (err) {
						bus.emit('tool_error', { toolName: toolCall.name, error: err, step, metadata });
						if (onToolError === 'throw') throw err;
						resultStr = `Error: ${err instanceof Error ? err.message : String(err)}`;
					}

					if (hooks.afterToolCall) resultStr = await hooks.afterToolCall(toolCall.name, resultStr);

					bus.emit('tool_result', { toolName: toolCall.name, result: resultStr, step, metadata });
					agentContext.push({
						role: 'tool',
						content: resultStr,
						toolCallId: toolCall.id,
						toolName: toolCall.name,
					});

					if (combinedSignal?.aborted) break;
				}

				if (toolCalls.length === 0) {
					bus.emit('complete', { finalMessage: agentContext[agentContext.length - 1], totalUsage, metadata });
					break;
				}

				if (maxContextMessages !== undefined && agentContext.length > maxContextMessages) {
					if (hooks.onContextOverflow) {
						const before = agentContext.length;
						agentContext = await hooks.onContextOverflow(agentContext);
						bus.emit('context_trim', { before, after: agentContext.length, step, metadata });
					} else {
						throw new AgentContextLimitError(maxContextMessages, agentContext);
					}
				}
			}
		} finally {
			runController = null;
		}

		return agentContext;
	};

	return { start, stop, getContext, bus };
}
