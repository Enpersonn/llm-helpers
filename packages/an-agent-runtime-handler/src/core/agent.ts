import type { LLMMessage, LLMRequest, ToolDefinition, ToolProvider } from '@llm-helpers/types';
import { type AgentEventMap, type Bus, createBus } from './bus.js';

type Provider = ToolProvider;

type ToolsList = {
	call: (args: Record<string, unknown>) => unknown | Promise<unknown>;
	def: ToolDefinition;
}[];

export default function createAgent<TExtra extends Record<string, unknown> = Record<never, never>>(
	provider: Provider,
	tools: ToolsList,
): { start: (request: LLMRequest) => Promise<LLMMessage[]>; bus: Bus<AgentEventMap & TExtra> } {
	const toolsList = tools.map((t) => t.def);
	const internalBus = createBus<AgentEventMap>();
	const bus = internalBus as unknown as Bus<AgentEventMap & TExtra>;

	const start = async (request: LLMRequest) => {
		let concluded = false;
		let step = 0;
		const agentContext: LLMMessage[] = [...request.messages];

		while (!concluded) {
			const res = await provider.tool({ ...request, messages: agentContext, tools: toolsList });

			if (res.thinkingContent) {
				internalBus.emit('thinking', { content: res.thinkingContent, step });
			}

			agentContext.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });

			if (res.finishReason === 'stop') {
				concluded = true;
			} else {
				for (const toolCall of res.toolCalls) {
					const tool = tools.find((t) => t.def.name === toolCall.name);
					if (!tool) continue;

					internalBus.emit('tool_call', { toolName: toolCall.name, args: toolCall.arguments, step });

					const result = await tool.call(toolCall.arguments);
					const resultStr = typeof result === 'string' ? result : JSON.stringify(result);

					internalBus.emit('tool_result', { toolName: toolCall.name, result: resultStr, step });

					agentContext.push({
						role: 'tool',
						content: resultStr,
						toolCallId: toolCall.id,
						toolName: toolCall.name,
					});
				}
			}

			step++;
		}

		return agentContext;
	};

	return { start, bus };
}
