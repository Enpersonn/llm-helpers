import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { McpConnectionError } from '../core/errors.js';
import type { JsonRpcMessage, McpTransport } from '../types.js';

type StdioTransportConfig = {
	command: string;
	args?: string[];
	env?: Record<string, string>;
	cwd?: string;
	shutdownGraceMs?: number;
};

const waitForExit = (child: ChildProcess, timeoutMs: number): Promise<void> =>
	new Promise((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
	});

export const createStdioTransport = (config: StdioTransportConfig): McpTransport => {
	const { command, args = [], env, cwd, shutdownGraceMs = 3000 } = config;
	const handlers = new Set<(msg: JsonRpcMessage) => void>();
	let child: ChildProcess | null = null;
	let buffer = '';
	let connected = false;

	const dispatchMessage = (raw: string): void => {
		let msg: JsonRpcMessage;
		try {
			msg = JSON.parse(raw) as JsonRpcMessage;
		} catch {
			return;
		}
		for (const h of handlers) {
			try {
				h(msg);
			} catch {
				// handler errors must not propagate
			}
		}
	};

	return {
		async connect() {
			if (connected) return;

			const mergedEnv = env ? { ...process.env, ...env } : process.env;

			child = spawn(command, args, {
				env: mergedEnv as NodeJS.ProcessEnv,
				cwd,
				stdio: ['pipe', 'pipe', 'pipe'],
			});

			if (!child.stdout || !child.stdin) {
				throw new McpConnectionError(`Failed to spawn process: ${command}`);
			}

			child.stdout.setEncoding('utf8');
			child.stdout.on('data', (chunk: string) => {
				buffer += chunk;
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (trimmed) dispatchMessage(trimmed);
				}
			});

			child.stderr?.on('data', (_chunk: unknown) => {
				// stderr available for debugging but not emitted
			});

			child.once('exit', (code, signal) => {
				if (connected) {
					connected = false;
					const reason = signal ? `signal ${signal}` : `exit code ${code ?? 'unknown'}`;
					for (const h of handlers) {
						try {
							h({
								jsonrpc: '2.0',
								method: '_transport/closed',
								params: { reason },
							});
						} catch {
							// ignore
						}
					}
				}
			});

			connected = true;
		},

		async disconnect() {
			if (!child) return;
			connected = false;

			child.stdin?.end();
			await waitForExit(child, shutdownGraceMs);

			if (child.exitCode === null) {
				child.kill('SIGTERM');
				await waitForExit(child, shutdownGraceMs);
			}

			if (child.exitCode === null) {
				child.kill('SIGKILL');
			}

			child = null;
			buffer = '';
		},

		async send(message: JsonRpcMessage) {
			if (!child?.stdin) throw new McpConnectionError('Transport not connected');
			const data = JSON.stringify(message) + '\n';
			await new Promise<void>((resolve, reject) => {
				child!.stdin!.write(data, (err) => {
					if (err) reject(new McpConnectionError(`Failed to write to stdin: ${err.message}`));
					else resolve();
				});
			});
		},

		onMessage(handler: (msg: JsonRpcMessage) => void): () => void {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
	};
};
