import { AgentAbortError, createAgent } from '@llm-helpers/an-agent-runtime-handler';
import { ollama as ollamaProvider } from '@llm-helpers/an-llm-request-router/ollama';
import type { ToolCall, ToolExecutionContext, ToolResult } from '@llm-helpers/tools';
import {
	allow,
	createFunctionProvider,
	createPermissions,
	createToolBackend,
	createToolSystem,
	defineTool,
	deny,
} from '@llm-helpers/tools';
import { z } from 'zod';

const MODEL = process.env.OLLAMA_TOOL_MODEL ?? 'gemma4';

// ─── Shared data ─────────────────────────────────────────────────────────────

const WAREHOUSE: Record<string, { stock: number; reorderThreshold: number; unitCost: number }> = {
	apples: { stock: 12, reorderThreshold: 50, unitCost: 0.3 },
	bananas: { stock: 3, reorderThreshold: 40, unitCost: 0.15 },
	oranges: { stock: 75, reorderThreshold: 30, unitCost: 0.45 },
	grapes: { stock: 8, reorderThreshold: 25, unitCost: 1.2 },
	mangoes: { stock: 0, reorderThreshold: 20, unitCost: 2.5 },
};

const ANALYTICS: Record<string, { trend: 'rising' | 'stable' | 'declining'; demandForecast: number }> = {
	apples: { trend: 'rising', demandForecast: 80 },
	bananas: { trend: 'rising', demandForecast: 60 },
	oranges: { trend: 'declining', demandForecast: 20 },
	grapes: { trend: 'stable', demandForecast: 30 },
	mangoes: { trend: 'rising', demandForecast: 40 },
};

// ─── Tool providers ───────────────────────────────────────────────────────────

function makeWarehouseProvider() {
	return createFunctionProvider('warehouse', [
		defineTool({
			name: 'list_products',
			description: 'Returns all product names in the warehouse.',
			input: z.object({}),
			execute: () => Object.keys(WAREHOUSE),
		}),
		defineTool({
			name: 'get_stock_level',
			description: 'Returns current stock, reorder threshold, and unit cost for a product.',
			input: z.object({
				product: z.string().describe('Product name (lowercase)'),
			}),
			execute: ({ product }) => {
				const entry = WAREHOUSE[product.toLowerCase()];
				if (!entry) return { error: `Unknown product: ${product}` };
				return {
					product,
					stock: entry.stock,
					reorderThreshold: entry.reorderThreshold,
					unitCost: entry.unitCost,
				};
			},
		}),
		defineTool({
			name: 'calculate_restock_cost',
			description: 'Calculates restock cost for a given quantity. Bulk discounts: 5% ≥10, 12% ≥50, 20% ≥100.',
			input: z.object({
				product: z.string().describe('Product name (lowercase)'),
				quantity: z.number().describe('Units to order'),
			}),
			execute: ({ product, quantity }) => {
				const entry = WAREHOUSE[product.toLowerCase()];
				if (!entry) return { error: `Unknown product: ${product}` };
				let discount = 0;
				if (quantity >= 100) discount = 0.2;
				else if (quantity >= 50) discount = 0.12;
				else if (quantity >= 10) discount = 0.05;
				const gross = quantity * entry.unitCost;
				const net = gross * (1 - discount);
				return {
					product,
					quantity,
					unitCost: entry.unitCost,
					discountPct: discount * 100,
					grossCost: gross,
					netCost: net,
				};
			},
		}),
		defineTool({
			name: 'generate_restock_report',
			description: 'Produces a formatted restock summary. Call once you have all cost data.',
			input: z.object({
				items: z
					.array(
						z.object({
							product: z.string(),
							quantity: z.number(),
							netCost: z.number(),
							trend: z.string().optional(),
						}),
					)
					.describe('Line items to include'),
			}),
			execute: ({ items }) => {
				const total = items.reduce((sum, i) => sum + i.netCost, 0);
				const lines = items.map(
					(i) =>
						`  - ${i.product}: ${i.quantity} units @ $${i.netCost.toFixed(2)}${i.trend ? ` [${i.trend}]` : ''}`,
				);
				return [
					'=== RESTOCK REPORT ===',
					...lines,
					`  TOTAL: $${total.toFixed(2)}`,
					'======================',
				].join('\n');
			},
		}),
	]);
}

// Custom ToolBackend built with createToolBackend (exercises the low-level API)
function makeAnalyticsBackend() {
	return createToolBackend({
		id: 'analytics',
		listTools: async () => [
			{
				name: 'get_demand_forecast',
				description: 'Returns demand trend (rising/stable/declining) and forecast units for a product.',
				inputSchema: {
					type: 'object',
					properties: { product: { type: 'string', description: 'Product name (lowercase)' } },
					required: ['product'],
				},
			},
			{
				name: 'get_trending_products',
				description: 'Returns the list of products with a rising demand trend.',
				inputSchema: { type: 'object', properties: {} },
			},
		],
		callTool: async (call: ToolCall, _ctx: ToolExecutionContext): Promise<ToolResult> => {
			if (call.name === 'get_trending_products') {
				const trending = Object.entries(ANALYTICS)
					.filter(([, v]) => v.trend === 'rising')
					.map(([k]) => k);
				return { toolCallId: call.id, ok: true, content: [{ type: 'json', value: trending }] };
			}

			if (call.name === 'get_demand_forecast') {
				const product = String(call.arguments.product ?? '').toLowerCase();
				const data = ANALYTICS[product];
				if (!data) {
					return {
						toolCallId: call.id,
						ok: false,
						content: [],
						error: { message: `Unknown product: ${product}`, code: 'NOT_FOUND' },
					};
				}
				return {
					toolCallId: call.id,
					ok: true,
					content: [{ type: 'json', value: { product, ...data } }],
					metadata: { provider: 'analytics' },
				};
			}

			return {
				toolCallId: call.id,
				ok: false,
				content: [],
				error: { message: `Unknown tool: ${call.name}`, code: 'TOOL_NOT_FOUND' },
			};
		},
	});
}

// Unreliable provider wrapper — fails first N calls to exercise the retry policy
function makeUnreliableProvider(inner: ReturnType<typeof ollamaProvider.create>, failCount: number) {
	let callsMade = 0;
	return {
		capabilities: inner.capabilities,
		tool: async (req: Parameters<typeof inner.tool>[0]) => {
			callsMade++;
			if (callsMade <= failCount) {
				throw new Error(`[simulated LLM error] attempt ${callsMade}/${failCount}`);
			}
			return inner.tool(req);
		},
	};
}

// ─── Logging helpers ──────────────────────────────────────────────────────────

function header(title: string) {
	console.log(`\n${'═'.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'═'.repeat(60)}`);
}

function attachBusLogger(bus: ReturnType<typeof createAgent>['bus'], label: string) {
	bus.on('step_start', (e) =>
		console.log(`  [${label}] step_start   step=${e.step} meta=${JSON.stringify(e.metadata)}`),
	);
	bus.on('step_end', (e) =>
		console.log(
			`  [${label}] step_end     step=${e.step} in=${e.usage?.inputTokens ?? 0} out=${e.usage?.outputTokens ?? 0}`,
		),
	);
	bus.on('thinking', (e) => console.log(`  [${label}] thinking     step=${e.step} "${e.content.slice(0, 80)}..."`));
	bus.on('tool_call', (e) =>
		console.log(`  [${label}] tool_call    ${e.toolName}(${JSON.stringify(e.args).slice(0, 60)})`),
	);
	bus.on('tool_result', (e) => console.log(`  [${label}] tool_result  ${e.toolName} → ${e.result.slice(0, 80)}`));
	bus.on('tool_error', (e) => console.warn(`  [${label}] tool_error   ${e.toolName}:`, e.error));
	bus.on('retry', (e) =>
		console.log(`  [${label}] retry        step=${e.step} attempt=${e.attempt} delay=${e.delayMs}ms`),
	);
	bus.on('context_trim', (e) =>
		console.log(`  [${label}] context_trim before=${e.before} after=${e.after} step=${e.step}`),
	);
	bus.on('aborted', (e) => console.log(`  [${label}] aborted      reason=${e.reason}`));
	bus.on('complete', (e) =>
		console.log(
			`  [${label}] complete     in=${e.totalUsage.inputTokens ?? 0} out=${e.totalUsage.outputTokens ?? 0}`,
		),
	);
}

// ─── Scenario A: Multi-backend + Permissions + All Hooks + Metadata ───────────

async function scenarioA(baseProvider: ReturnType<typeof ollamaProvider.create>) {
	header('Scenario A — Multi-backend · Permissions · All Hooks · Metadata');

	const permissions = createPermissions({
		rules: [
			// Read-only analytics always allowed
			allow('get_trending_products'),
			allow('get_demand_forecast'),
			// Warehouse reads always allowed
			allow('list_products'),
			allow('get_stock_level'),
			// Block bulk orders over 150 units — require manual approval above that
			deny('calculate_restock_cost', {
				when: (args) => typeof args.quantity === 'number' && args.quantity > 150,
				reason: 'Orders above 150 units require manager sign-off',
			}),
			allow('calculate_restock_cost'),
			allow('generate_restock_report'),
		],
		default: 'deny',
	});

	const toolSystem = createToolSystem({
		providers: [makeWarehouseProvider(), makeAnalyticsBackend()],
		permissions,
		timeout: (name) => (name === 'generate_restock_report' ? 5_000 : 10_000),
	});

	const agent = createAgent(baseProvider, toolSystem, {
		maxSteps: 25,
		metadata: { sessionId: 'scenario-A', env: 'demo' },
		onToolError: 'continue',
		hooks: {
			beforeLLMCall: (req) => {
				console.log(`  [hook:beforeLLMCall] tools available: ${req.tools.map((t) => t.name).join(', ')}`);
				return req;
			},
			afterLLMCall: (res) => {
				console.log(
					`  [hook:afterLLMCall]  finishReason=${res.finishReason} toolCalls=${res.toolCalls.length}`,
				);
				return res;
			},
			beforeToolCall: (toolName, args) => {
				console.log(`  [hook:beforeToolCall] ${toolName} args=${JSON.stringify(args).slice(0, 80)}`);
				return args;
			},
			afterToolCall: (toolName, result) => {
				console.log(`  [hook:afterToolCall]  ${toolName} resultLen=${result.length}`);
				return result;
			},
		},
	});

	attachBusLogger(agent.bus, 'A');

	const messages = [
		{
			role: 'user' as const,
			content:
				"First find out which products have rising demand. Then check each product's stock level. " +
				'For any product that is below its reorder threshold AND has rising or stable demand, ' +
				'calculate the restock cost to reach its threshold. ' +
				'Finally, produce a full restock report including the trend label for each item.',
		},
	];

	console.log(`\nUser: ${messages[0].content}\n`);

	try {
		const history = await agent.start({ messages });
		const last = history.at(-1);
		console.log(`\nAgent: ${last?.content}`);
	} catch (err) {
		console.error('Scenario A error:', err instanceof Error ? err.message : err);
	}
}

// ─── Scenario B: Context Overflow → Trim Hook ─────────────────────────────────

async function scenarioB(baseProvider: ReturnType<typeof ollamaProvider.create>) {
	header('Scenario B — Context Overflow + onContextOverflow Trim Hook');

	const toolSystem = createToolSystem({ providers: [makeWarehouseProvider()] });

	let trimCount = 0;

	const agent = createAgent(baseProvider, toolSystem, {
		maxSteps: 30,
		// Trigger overflow after 10 messages in context
		maxContextMessages: 10,
		metadata: { scenario: 'B' },
		onToolError: 'continue',
		hooks: {
			onContextOverflow: (messages) => {
				trimCount++;
				// Keep the initial user message + the last 5 messages
				const pinned = messages.slice(0, 1);
				const tail = messages.slice(-5);
				console.log(
					`  [hook:onContextOverflow] trim #${trimCount}: ${messages.length} → ${pinned.length + tail.length} messages`,
				);
				return [...pinned, ...tail];
			},
		},
	});

	attachBusLogger(agent.bus, 'B');

	const messages = [
		{
			role: 'user' as const,
			content:
				'Check every single product one by one: list them, then for each product get its stock level, ' +
				'then check its demand forecast. Report a summary of all findings when done.',
		},
	];

	console.log(`\nUser: ${messages[0].content}\n`);

	try {
		const history = await agent.start({ messages });
		const last = history.at(-1);
		console.log(`\nAgent: ${last?.content}`);
		console.log(`\nContext trim fired ${trimCount} time(s). Final context length: ${history.length} messages.`);
	} catch (err) {
		console.error('Scenario B error:', err instanceof Error ? err.message : err);
	}
}

// ─── Scenario C: Graceful Abort via agent.stop() ──────────────────────────────

async function scenarioC(baseProvider: ReturnType<typeof ollamaProvider.create>) {
	header('Scenario C — Graceful Abort via agent.stop()');

	const toolSystem = createToolSystem({ providers: [makeWarehouseProvider(), makeAnalyticsBackend()] });

	const agent = createAgent(baseProvider, toolSystem, {
		maxSteps: 50,
		metadata: { scenario: 'C' },
	});

	attachBusLogger(agent.bus, 'C');

	// Stop the agent after the first step completes
	agent.bus.once('step_end', () => {
		console.log('\n  [demo] Calling agent.stop() after first step...');
		agent.stop();
	});

	const messages = [
		{
			role: 'user' as const,
			content:
				'Do a comprehensive analysis: list all products, get stock levels for each, check demand forecasts, ' +
				'identify restocking needs, calculate all costs, and produce a detailed report.',
		},
	];

	console.log(`\nUser: ${messages[0].content}\n`);

	try {
		await agent.start({ messages });
		console.log('\nAgent finished without being stopped (task completed in one step).');
	} catch (err) {
		if (err instanceof AgentAbortError) {
			console.log(`\nCaught AgentAbortError — reason: "${err.reason}"`);
			console.log(`Context at abort: ${err.context.length} messages captured.`);
		} else {
			console.error('Scenario C unexpected error:', err);
		}
	}
}

// ─── Scenario D: Retry Policy ─────────────────────────────────────────────────

async function scenarioD(baseProvider: ReturnType<typeof ollamaProvider.create>) {
	header('Scenario D — Retry Policy (provider fails first 2 LLM calls)');

	const unreliableProvider = makeUnreliableProvider(baseProvider, 2);
	const toolSystem = createToolSystem({ providers: [makeWarehouseProvider()] });

	const agent = createAgent(unreliableProvider, toolSystem, {
		maxSteps: 10,
		metadata: { scenario: 'D' },
		retry: {
			maxAttempts: 4,
			backoff: (attempt, error) => {
				console.log(
					`  [retry:backoff] attempt=${attempt} error="${error instanceof Error ? error.message : error}"`,
				);
				return attempt * 300; // 300ms, 600ms, 900ms...
			},
		},
	});

	attachBusLogger(agent.bus, 'D');

	const messages = [
		{
			role: 'user' as const,
			content: 'List all warehouse products and their current stock levels.',
		},
	];

	console.log(`\nUser: ${messages[0].content}\n`);
	console.log('  (Provider will throw errors on the first 2 LLM calls to exercise retry)\n');

	try {
		const history = await agent.start({ messages });
		const last = history.at(-1);
		console.log(`\nAgent: ${last?.content}`);
	} catch (err) {
		console.error('Scenario D error:', err instanceof Error ? err.message : err);
	}
}

// ─── Entry point ─────────────────────────────────────────────────────────────

export async function runAgentDemo() {
	console.log(`\nModel: ${MODEL}`);

	const provider = ollamaProvider.create({ model: MODEL });

	await scenarioA(provider);
	await scenarioB(provider);
	await scenarioC(provider);
	await scenarioD(provider);
}
