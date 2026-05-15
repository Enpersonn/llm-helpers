import type { ToolBackend, ToolContent } from '@llm-helpers/types';
import { z } from 'zod';

export type FunctionTool = {
	name: string;
	description: string;
	inputSchema: Record<string, unknown>;
	execute(args: Record<string, unknown>): unknown | Promise<unknown>;
};

export function defineTool<TSchema extends z.ZodObject<z.ZodRawShape>>(config: {
	name: string;
	description: string;
	input: TSchema;
	execute(args: z.infer<TSchema>): unknown | Promise<unknown>;
}): FunctionTool {
	const jsonSchema = z.toJSONSchema(config.input) as Record<string, unknown>;
	return {
		name: config.name,
		description: config.description,
		inputSchema: jsonSchema,
		execute: async (rawArgs) => {
			const result = config.input.safeParse(rawArgs);
			if (!result.success) {
				const detail = result.error.issues
					.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
					.join(', ');
				throw new Error(`Invalid arguments for '${config.name}': ${detail}`);
			}
			return config.execute(result.data);
		},
	};
}

export const createFunctionProvider = (id: string, tools: FunctionTool[]): ToolBackend => ({
	id,
	listTools: async () =>
		tools.map((t) => ({
			name: t.name,
			description: t.description,
			inputSchema: t.inputSchema,
		})),
	callTool: async (call, _context) => {
		const tool = tools.find((t) => t.name === call.name);

		if (!tool) {
			return {
				toolCallId: call.id,
				ok: false,
				content: [],
				error: { message: `Unknown tool: ${call.name}`, code: 'TOOL_NOT_FOUND' },
			};
		}

		const raw = await tool.execute(call.arguments);

		let content: ToolContent[];
		if (typeof raw === 'string') {
			content = [{ type: 'text', text: raw }];
		} else if (raw === null || raw === undefined) {
			content = [{ type: 'text', text: '' }];
		} else {
			content = [{ type: 'json', value: raw }];
		}

		return { toolCallId: call.id, ok: true, content };
	},
});
