import { createAgent } from '@llm-helpers/an-agent-runtime-handler';
import { ollama } from '@llm-helpers/an-llm-request-router/ollama';
import { createMcpClient, createNpxStdioTransport } from '@llm-helpers/an-mcp-runtime-handler';
import { createMcpProvider, createToolSystem } from '@llm-helpers/tools';

const MODEL = 'gemma4';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function header(title: string) {
	console.log(`\n${'═'.repeat(60)}`);
	console.log(`  ${title}`);
	console.log(`${'═'.repeat(60)}`);
}

// ─── Main demo ────────────────────────────────────────────────────────────────

export async function runMcpDemo() {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error('GEMINI_API_KEY not set');

	const provider = ollama.create({ model: MODEL });

	// Point the filesystem server at the monorepo root so the agent has
	// something interesting to explore.
	// 3 levels up from apps/demo-space/src/ → monorepo root
	const repoRoot = new URL('../../../', import.meta.url).pathname;

	header('MCP Demo — filesystem server via npx + Gemini agent');
	console.log(`  Filesystem root: ${repoRoot}`);
	console.log(`  Model: ${MODEL}\n`);

	// ── 1. Create and connect the MCP client ──────────────────────────────────
	const client = createMcpClient(
		createNpxStdioTransport({
			package: '@modelcontextprotocol/server-filesystem',
			args: [repoRoot],
		}),
		{
			timeout: 15_000,
			hooks: {
				afterInitialize: (info) => {
					console.log(`  [mcp] connected to "${info.name}" v${info.version}`);
					console.log(`  [mcp] capabilities: ${JSON.stringify(info.capabilities)}`);
				},
			},
		},
	);

	// Forward MCP bus events to console
	client.bus.on('tool_call', (e) =>
		console.log(`  [mcp] tool_call   ${e.name}(${JSON.stringify(e.args).slice(0, 80)})`),
	);
	client.bus.on('tool_result', (e) =>
		console.log(`  [mcp] tool_result ${e.name} → isError=${e.result.isError ?? false}`),
	);
	client.bus.on('tool_error', (e) => console.warn(`  [mcp] tool_error  ${e.name}:`, e.error));
	client.bus.on('disconnected', (e) => console.log(`  [mcp] disconnected reason=${e.reason ?? 'clean'}`));

	await client.connect();

	const tools = await client.listTools();
	console.log(`\n  Tools available: ${tools.map((t) => t.name).join(', ')}\n`);

	// ── 2. Wire the MCP client into the tool system ───────────────────────────
	const mcpRuntime = {
		listTools: async () => {
			const t = await client.listTools();
			return t.map((tool) => ({ ...tool, serverName: 'fs' }));
		},
		callTool: async (params: {
			serverName: string;
			name: string;
			arguments: Record<string, unknown>;
			options?: { signal?: AbortSignal };
		}) => {
			return client.callTool(params.name, params.arguments, { signal: params.options?.signal });
		},
	};

	const toolSystem = createToolSystem({
		providers: [createMcpProvider(mcpRuntime)],
	});

	// ── 3. Run the agent ──────────────────────────────────────────────────────
	const agent = createAgent(provider, toolSystem, {
		maxSteps: 10,
		timeout: 60_000,
	});

	agent.bus.on('step_start', (e) => console.log(`  [agent] step ${e.step} started`));
	agent.bus.on('tool_call', (e) => console.log(`  [agent] calling tool: ${e.toolName}`));
	agent.bus.on('tool_result', (e) =>
		console.log(`  [agent] tool result: ${e.toolName} (${e.result.slice(0, 60)}...)`),
	);
	agent.bus.on('complete', (e) =>
		console.log(`  [agent] done — in=${e.totalUsage.inputTokens ?? 0} out=${e.totalUsage.outputTokens ?? 0}`),
	);

	const question =
		'List the top-level directories and files in the repo root. ' +
		'Then read the root package.json and tell me what workspace packages are configured.';

	console.log(`User: ${question}\n`);

	try {
		const history = await agent.start({
			messages: [{ role: 'user', content: question }],
		});
		const last = history.at(-1);
		console.log(`\nAgent: ${last?.content}`);
	} catch (err) {
		console.error('\nAgent error:', err instanceof Error ? err.message : err);
	} finally {
		await client.disconnect();
	}
}
