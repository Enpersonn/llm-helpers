import { stdin, stdout } from 'node:process';
import * as readline from 'node:readline/promises';
import { createAgent } from '@llm-helpers/an-agent-runtime-handler';
import { ollama } from '@llm-helpers/an-llm-request-router/ollama';
import { createMcpClient, createMcpManager, createNpxStdioTransport } from '@llm-helpers/an-mcp-runtime-handler';
import { createMcpProvider, createToolSystem } from '@llm-helpers/tools';
import type { LLMMessage } from '@llm-helpers/types';

const MODEL = 'gemma4';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function header(title: string) {
	console.log(`\n${'═'.repeat(62)}`);
	console.log(`  ${title}`);
	console.log(`${'═'.repeat(62)}`);
}

function serverLabel(toolName: string): string {
	const server = toolName.split('.')[1] ?? '?';
	return server === 'pw' ? 'browser' : server;
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a helpful assistant with access to two tool sets:

1. Filesystem (mcp.fs.*): read, write, list, search files in the local monorepo.
2. Browser (mcp.pw.*): control a headless Chromium browser — navigate, take
   screenshots, click, fill forms, etc.

Pick the right tool for the task. When taking a screenshot, describe what is
visible on the page. Be concise.`;

// ─── Main demo ────────────────────────────────────────────────────────────────

export async function runMcpManagerDemo() {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) throw new Error('GEMINI_API_KEY not set');

	const provider = ollama.create({ model: MODEL });

	// 3 levels up from apps/demo-space/src/ → monorepo root
	const repoRoot = new URL('../../../', import.meta.url).pathname;

	header('MCP Manager Demo — Playwright + Filesystem');
	console.log(`  Model          : ${MODEL}`);
	console.log(`  Filesystem root: ${repoRoot}`);
	console.log('\n  Starting MCP servers... (first run may download packages)\n');

	// ── 1. Create clients ──────────────────────────────────────────────────────

	const fsClient = createMcpClient(
		createNpxStdioTransport({
			package: '@modelcontextprotocol/server-filesystem',
			args: [repoRoot],
		}),
		{
			timeout: 20_000,
			hooks: {
				afterInitialize: (info) => console.log(`  [fs]  connected — "${info.name}" v${info.version}`),
			},
		},
	);

	const pwClient = createMcpClient(
		createNpxStdioTransport({
			package: '@playwright/mcp',
			args: ['--headless'],
		}),
		{
			timeout: 60_000,
			hooks: {
				afterInitialize: (info) => console.log(`  [pw]  connected — "${info.name}" v${info.version}`),
			},
		},
	);

	// ── 2. Create and connect the manager ─────────────────────────────────────

	const manager = createMcpManager({
		servers: {
			fs: { client: fsClient },
			pw: { client: pwClient },
		},
	});

	manager.bus.on('server_connected', ({ name, serverInfo }) =>
		console.log(`  [manager] ${name} → ready (${serverInfo.name})`),
	);
	manager.bus.on('server_disconnected', ({ name, reason }) =>
		console.log(`  [manager] ${name} → disconnected (${reason ?? 'clean'})`),
	);
	manager.bus.on('server_error', ({ name, error }) => console.warn(`  [manager] ${name} → error:`, error));
	manager.bus.on('server_tools_changed', ({ name }) => console.log(`  [manager] ${name} → tools updated`));

	await manager.connectAll();

	const allTools = await manager.listTools();
	const byServer = allTools.reduce<Record<string, number>>((acc, t) => {
		acc[t.serverName] = (acc[t.serverName] ?? 0) + 1;
		return acc;
	}, {});
	console.log(
		`\n  ${allTools.length} tools available — ${Object.entries(byServer)
			.map(([s, n]) => `${s}: ${n}`)
			.join(', ')}\n`,
	);

	// ── 3. Wire manager into the tool system ──────────────────────────────────
	// createMcpManager satisfies the McpRuntime interface directly.

	const toolSystem = createToolSystem({
		providers: [createMcpProvider(manager)],
	});

	// ── 4. Interactive REPL ───────────────────────────────────────────────────

	const rl = readline.createInterface({ input: stdin, output: stdout });

	console.log(`${'─'.repeat(62)}`);
	console.log('  Ask anything — the agent browses the web or reads local files.');
	console.log('  Type "exit" or Ctrl+C to quit.\n');

	// Rolling history — keeps multi-turn context without unbounded growth.
	let history: LLMMessage[] = [];

	const handleExit = async () => {
		console.log('\n  Disconnecting all servers...');
		await manager.disconnectAll();
		console.log('  Done.\n');
		process.exit(0);
	};

	process.on('SIGINT', handleExit);

	try {
		while (true) {
			const question = (await rl.question('You> ')).trim();
			if (!question || question === 'exit' || question === 'quit') break;

			console.log();

			const agent = createAgent(provider, toolSystem, {
				maxSteps: 20,
				timeout: 120_000,
				onToolError: 'continue',
			});

			agent.bus.on('step_start', (e) => process.stdout.write(`  [agent] step ${e.step}\n`));
			agent.bus.on('tool_call', (e) => {
				const label = serverLabel(e.toolName);
				const tool = e.toolName.split('.').slice(2).join('.');
				const argStr = JSON.stringify(e.args);
				console.log(`  [${label}] ↪ ${tool}(${argStr.length > 80 ? argStr.slice(0, 80) + '…' : argStr})`);
			});
			agent.bus.on('tool_result', (e) => {
				const label = serverLabel(e.toolName);
				const tool = e.toolName.split('.').slice(2).join('.');
				console.log(`  [${label}] ↩ ${tool} → ${e.result.length} chars`);
			});
			agent.bus.on('tool_error', (e) => {
				console.warn(`  [agent] tool error: ${e.toolName}:`, e.error);
			});
			agent.bus.on('complete', (e) =>
				console.log(
					`  [agent] done — in=${e.totalUsage.inputTokens ?? 0} out=${e.totalUsage.outputTokens ?? 0}\n`,
				),
			);

			const messages: LLMMessage[] = [
				{ role: 'system', content: SYSTEM_PROMPT },
				...history,
				{ role: 'user', content: question },
			];

			try {
				const result = await agent.start({ messages });
				const last = result.at(-1);
				if (last) {
					console.log(`Agent: ${last.content}\n`);
					// Retain the last 3 user+assistant exchanges for context.
					const turns = result.filter((m) => m.role === 'user' || m.role === 'assistant');
					history = turns.slice(-6);
				}
			} catch (err) {
				console.error('Agent error:', err instanceof Error ? err.message : err, '\n');
			}
		}
	} finally {
		rl.close();
		process.off('SIGINT', handleExit);
		console.log('\n  Disconnecting all servers...');
		await manager.disconnectAll();
		console.log('  Done.\n');
	}
}
