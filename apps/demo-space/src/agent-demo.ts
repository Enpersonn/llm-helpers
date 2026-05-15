import { createAgent } from '@llm-helpers/an-agent-runtime-handler';
import { ollama as ollamaProvider } from '@llm-helpers/an-llm-request-router/ollama';

const MODEL = process.env.OLLAMA_TOOL_MODEL ?? 'gemma4';

const tools = [
	{
		def: {
			name: 'calculate',
			description: 'Evaluates a basic arithmetic expression and returns the result.',
			parameters: {
				type: 'object',
				properties: {
					expression: { type: 'string', description: 'A math expression, e.g. "1337 + 42"' },
				},
				required: ['expression'],
			},
		},
		call: (args: Record<string, unknown>) => {
			const expr = String(args.expression ?? '');
			const result = Function(`"use strict"; return (${expr})`)();
			console.log(`  [tool:calculate] ${expr} = ${result}`);
			return String(result);
		},
	},
	{
		def: {
			name: 'get_current_time',
			description: 'Returns the current local time.',
			parameters: {
				type: 'object',
				properties: {},
			},
		},
		call: (_args: Record<string, unknown>) => {
			const time = new Date().toLocaleTimeString();
			console.log(`  [tool:get_current_time] ${time}`);
			return time;
		},
	},
];

export async function runAgentDemo() {
	const provider = ollamaProvider.create({ model: MODEL });

	const agent = createAgent(provider, tools);

	const messages = [
		{
			role: 'user' as const,
			content: 'what is the current time plus 15 minutes? Please use all the available tools.',
		},
	];

	console.log(`\nUsing model: ${MODEL}`);
	console.log(`User: ${messages[0].content}\n`);

	const history = await agent.start({ messages });

	const lastMessage = history.at(-1);
	console.log(`\nAgent: ${lastMessage?.content}`);
}
