import { createAgent } from '@llm-helpers/an-agent-runtime-handler';
import { ollama as ollamaProvider } from '@llm-helpers/an-llm-request-router/ollama';

const MODEL = process.env.OLLAMA_TOOL_MODEL ?? 'gemma4';

// Simulated warehouse database
const WAREHOUSE: Record<string, { stock: number; reorderThreshold: number; unitCost: number }> = {
	apples:   { stock: 12,  reorderThreshold: 50,  unitCost: 0.30 },
	bananas:  { stock: 3,   reorderThreshold: 40,  unitCost: 0.15 },
	oranges:  { stock: 75,  reorderThreshold: 30,  unitCost: 0.45 },
	grapes:   { stock: 8,   reorderThreshold: 25,  unitCost: 1.20 },
	mangoes:  { stock: 0,   reorderThreshold: 20,  unitCost: 2.50 },
};


const tools = [
	{
		def: {
			name: 'list_products',
			description: 'Returns the list of all product names available in the warehouse.',
			parameters: { type: 'object', properties: {} },
		},
		call: (_args: Record<string, unknown>) => {
			const products = Object.keys(WAREHOUSE);
			console.log(`  [tool:list_products] → ${products.join(', ')}`);
			return products;
		},
	},
	{
		def: {
			name: 'get_stock_level',
			description: 'Returns the current stock level and reorder threshold for a product.',
			parameters: {
				type: 'object',
				properties: {
					product: { type: 'string', description: 'Product name (lowercase)' },
				},
				required: ['product'],
			},
		},
		call: (args: Record<string, unknown>) => {
			const product = String(args.product).toLowerCase();
			const entry = WAREHOUSE[product];
			if (!entry) return { error: `Unknown product: ${product}` };
			console.log(`  [tool:get_stock_level] ${product} → stock=${entry.stock}, threshold=${entry.reorderThreshold}`);
			return { product, stock: entry.stock, reorderThreshold: entry.reorderThreshold };
		},
	},
	{
		def: {
			name: 'calculate_restock_cost',
			description:
				'Calculates the total cost to restock a product up to its reorder threshold, including any bulk discount.',
			parameters: {
				type: 'object',
				properties: {
					product:  { type: 'string', description: 'Product name (lowercase)' },
					quantity: { type: 'number', description: 'Number of units to order' },
				},
				required: ['product', 'quantity'],
			},
		},
		call: (args: Record<string, unknown>) => {
			const product = String(args.product).toLowerCase();
			const quantity = Number(args.quantity);
			const entry = WAREHOUSE[product];
			if (!entry) return { error: `Unknown product: ${product}` };

			let discount = 0;
			if (quantity >= 100) discount = 0.20;
			else if (quantity >= 50) discount = 0.12;
			else if (quantity >= 10) discount = 0.05;

			const gross = quantity * entry.unitCost;
			const net   = gross * (1 - discount);

			console.log(
				`  [tool:calculate_restock_cost] ${product} ×${quantity} → gross=$${gross.toFixed(2)}, discount=${(discount * 100).toFixed(0)}%, net=$${net.toFixed(2)}`,
			);
			return { product, quantity, unitCost: entry.unitCost, discount, grossCost: gross, netCost: net };
		},
	},
	{
		def: {
			name: 'generate_restock_report',
			description:
				'Generates a formatted restock report from a list of restock line items. Call this once you have all cost data.',
			parameters: {
				type: 'object',
				properties: {
					items: {
						type: 'array',
						description: 'Array of restock items',
						items: {
							type: 'object',
							properties: {
								product:  { type: 'string' },
								quantity: { type: 'number' },
								netCost:  { type: 'number' },
							},
							required: ['product', 'quantity', 'netCost'],
						},
					},
				},
				required: ['items'],
			},
		},
		call: (args: Record<string, unknown>) => {
			const items = args.items as { product: string; quantity: number; netCost: number }[];
			const totalCost = items.reduce((sum, i) => sum + i.netCost, 0);

			const lines = items.map(
				(i) => `  - ${i.product}: order ${i.quantity} units  ($${i.netCost.toFixed(2)})`,
			);
			const report = [
				'=== RESTOCK REPORT ===',
				...lines,
				`  TOTAL: $${totalCost.toFixed(2)}`,
				'======================',
			].join('\n');

			console.log(`  [tool:generate_restock_report]\n${report}`);
			return report;
		},
	},
];

export async function runAgentDemo() {
	const provider = ollamaProvider.create({ model: MODEL });
	const agent = createAgent(provider, tools);

	const messages = [
		{
			role: 'user' as const,
			content:
				'Check every product in the warehouse. For each one that is below its reorder threshold, ' +
				'calculate how many units are needed to reach the threshold and what that restock will cost. ' +
				'Then produce a full restock report with the total spend.',
		},
	];

	console.log(`\nUsing model: ${MODEL}`);
	console.log(`User: ${messages[0].content}\n`);

	agent.bus.on('thinking', (e) => {
		console.log(`  [thinking:${e.step}] ${e.content.slice(0, 120)}...`);
	});

	const history = await agent.start({ messages });

	const lastMessage = history.at(-1);
	console.log(`\nAgent: ${lastMessage?.content}`);
}
