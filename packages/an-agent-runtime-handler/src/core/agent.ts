import type { LLMMessage, LLMRequest, ToolDefinition, ToolProvider } from '@llm-helpers/types';

type Provider = ToolProvider;

type ToolsList = {
	call: (args: Record<string, unknown>) => unknown | Promise<unknown>;
	def: ToolDefinition;
}[];

export default function createAgent(provider: Provider, tools: ToolsList) {
	const toolsList = tools.map((t) => t.def);

	const start = async (request: LLMRequest) => {
		let concluded = false;
		const agentContext: LLMMessage[] = [...request.messages];

		while (!concluded) {
			const res = await provider.tool({ ...request, messages: agentContext, tools: toolsList });

			agentContext.push({ role: 'assistant', content: res.text, toolCalls: res.toolCalls });

			if (res.finishReason === 'stop') {
				concluded = true;
			} else {
				for (const toolCall of res.toolCalls) {
					const tool = tools.find((t) => t.def.name === toolCall.name);
					if (!tool) continue;

					const result = await tool.call(toolCall.arguments);
					agentContext.push({
						role: 'tool',
						content: typeof result === 'string' ? result : JSON.stringify(result),
						toolCallId: toolCall.id,
						toolName: toolCall.name,
					});
				}
			}
		}

		return agentContext;
	};

	return { start };
}
