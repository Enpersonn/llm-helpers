import { callWithRetry, createBus } from '@llm-helpers/core';
import type {
	McpCallOptions,
	McpCallResult,
	McpClient,
	McpClientEventMap,
	McpClientOptions,
	McpClientState,
	McpCompletionRef,
	McpLogLevel,
	McpServerInfo,
	McpTask,
	McpTaskStatus,
	McpTool,
	McpTransport,
} from '../types.js';
import {
	McpCapabilityError,
	McpConnectionError,
	McpHandshakeError,
	McpProtocolError,
	McpTimeoutError,
} from './errors.js';
import {
	buildCancelNotification,
	buildCompletionRequest,
	buildErrorResponse,
	buildInitializedNotification,
	buildInitializeParams,
	buildInitializeRequest,
	buildLoggingSetLevelRequest,
	buildPingRequest,
	buildPongResponse,
	buildRootsChangedNotification,
	buildSuccessResponse,
	buildTasksCancelRequest,
	buildTasksGetRequest,
	buildTasksListRequest,
	buildTasksResultRequest,
	buildToolCallRequest,
	buildToolsListRequest,
	deriveClientCapabilities,
	MCP_PROTOCOL_VERSION,
	nextRequestId,
} from './protocol.js';

type PendingRequest = {
	resolve: (value: unknown) => void;
	reject: (reason: unknown) => void;
	timeoutHandle?: ReturnType<typeof setTimeout>;
	onProgress?: (progress: number, total?: number, message?: string) => void;
	progressToken?: string | number;
	signal?: AbortSignal;
	taskId?: string;
};

const TERMINAL_TASK_STATES: McpTaskStatus[] = ['completed', 'failed', 'cancelled'];
const JSONRPC_METHOD_NOT_FOUND = -32601;
const JSONRPC_INTERNAL_ERROR = -32603;

export const createMcpClient = (transport: McpTransport, options: McpClientOptions = {}): McpClient => {
	const { timeout: defaultTimeout, retry: retryPolicy = {}, hooks = {}, handlers = {}, keepAlive } = options;

	const bus = createBus<McpClientEventMap>();
	const pending = new Map<string | number, PendingRequest>();
	const progressTokenToId = new Map<string | number, string | number>();

	let state: McpClientState = 'idle';
	let serverInfo: McpServerInfo | null = null;
	let unsubscribeTransport: (() => void) | null = null;
	let keepAliveHandle: ReturnType<typeof setInterval> | null = null;

	const setState = (next: McpClientState): void => {
		state = next;
	};

	const rejectAllPending = (err: unknown): void => {
		for (const p of pending.values()) {
			clearTimeout(p.timeoutHandle);
			p.reject(err);
		}
		pending.clear();
		progressTokenToId.clear();
	};

	const handleMessage = (msg: unknown): void => {
		const m = msg as {
			jsonrpc?: string;
			id?: string | number;
			method?: string;
			params?: unknown;
			result?: unknown;
			error?: { code: number; message: string; data?: unknown };
		};

		// ── Response (id + no method) ──────────────────────────────────────────
		if (m.id !== undefined && !m.method) {
			const pend = pending.get(m.id);
			if (!pend) return;
			clearTimeout(pend.timeoutHandle);
			if (pend.progressToken !== undefined) progressTokenToId.delete(pend.progressToken);
			pending.delete(m.id);

			if (m.error) {
				pend.reject(new McpProtocolError(`JSON-RPC error ${m.error.code}: ${m.error.message}`));
			} else {
				pend.resolve(m.result);
			}
			return;
		}

		// ── Server-to-client request (id + method) ─────────────────────────────
		if (m.id !== undefined && m.method) {
			void handleServerRequest(m.id, m.method, m.params);
			return;
		}

		// ── Notification (method, no id) ───────────────────────────────────────
		if (!m.id && m.method) {
			handleNotification(m.method, m.params);
		}
	};

	const handleServerRequest = async (id: string | number, method: string, params: unknown): Promise<void> => {
		try {
			if (method === 'ping') {
				await transport.send(buildPongResponse(id));
				return;
			}

			if (method === 'sampling/createMessage') {
				if (!handlers.onSampling) {
					await transport.send(buildErrorResponse(id, JSONRPC_METHOD_NOT_FOUND, 'sampling not supported'));
					return;
				}
				const result = await handlers.onSampling(params as Parameters<typeof handlers.onSampling>[0]);
				await transport.send(buildSuccessResponse(id, result));
				return;
			}

			if (method === 'elicitation/create') {
				const p = params as { mode?: string };
				if (p?.mode === 'url') {
					if (!handlers.onUrlElicitation) {
						await transport.send(
							buildErrorResponse(id, JSONRPC_METHOD_NOT_FOUND, 'url elicitation not supported'),
						);
						return;
					}
					await handlers.onUrlElicitation(params as Parameters<typeof handlers.onUrlElicitation>[0]);
					await transport.send(buildSuccessResponse(id, {}));
				} else {
					if (!handlers.onElicitation) {
						await transport.send(
							buildErrorResponse(id, JSONRPC_METHOD_NOT_FOUND, 'elicitation not supported'),
						);
						return;
					}
					const result = await handlers.onElicitation(params as Parameters<typeof handlers.onElicitation>[0]);
					await transport.send(buildSuccessResponse(id, result));
				}
				return;
			}

			if (method === 'roots/list') {
				if (!handlers.onRootsList) {
					await transport.send(buildErrorResponse(id, JSONRPC_METHOD_NOT_FOUND, 'roots not supported'));
					return;
				}
				const roots = await handlers.onRootsList();
				await transport.send(buildSuccessResponse(id, { roots }));
				return;
			}

			await transport.send(buildErrorResponse(id, JSONRPC_METHOD_NOT_FOUND, `Unknown method: ${method}`));
		} catch (err) {
			try {
				await transport.send(buildErrorResponse(id, JSONRPC_INTERNAL_ERROR, 'Handler error'));
			} catch {
				// best-effort
			}
			bus.emit('error', { error: err });
		}
	};

	const handleNotification = (method: string, params: unknown): void => {
		const p = params as Record<string, unknown> | undefined;

		switch (method) {
			case 'notifications/tools/list_changed':
				bus.emit('tools_changed', {});
				break;
			case 'notifications/resources/list_changed':
				bus.emit('resources_changed', {});
				break;
			case 'notifications/resources/updated':
				bus.emit('resource_updated', { uri: String(p?.uri ?? '') });
				break;
			case 'notifications/prompts/list_changed':
				bus.emit('prompts_changed', {});
				break;
			case 'notifications/progress': {
				const token = p?.progressToken as string | number | undefined;
				const progress = Number(p?.progress ?? 0);
				const total = p?.total !== undefined ? Number(p.total) : undefined;
				const message = p?.message !== undefined ? String(p.message) : undefined;
				if (token !== undefined) {
					const reqId = progressTokenToId.get(token);
					if (reqId !== undefined) {
						pending.get(reqId)?.onProgress?.(progress, total, message);
					}
					bus.emit('progress', { progressToken: token, progress, total, message });
				}
				break;
			}
			case 'notifications/message':
				bus.emit('log_message', {
					level: (p?.level as McpClientEventMap['log_message']['level']) ?? 'info',
					logger: p?.logger !== undefined ? String(p.logger) : undefined,
					data: p?.data,
				});
				break;
			case 'notifications/cancelled': {
				const reqId = p?.requestId as string | number | undefined;
				const reason = p?.reason !== undefined ? String(p.reason) : undefined;
				if (reqId !== undefined) {
					const pend = pending.get(reqId);
					if (pend) {
						clearTimeout(pend.timeoutHandle);
						pending.delete(reqId);
						pend.reject(new McpProtocolError(`Request cancelled by server: ${reason ?? ''}`));
					}
				}
				bus.emit('cancelled', { requestId: reqId ?? '', reason });
				break;
			}
			case 'notifications/elicitation/complete':
				bus.emit('elicitation_complete', {
					elicitationId: String(p?.elicitationId ?? ''),
					action: (p?.action as McpClientEventMap['elicitation_complete']['action']) ?? 'cancel',
					content: p?.content as Record<string, unknown> | undefined,
				});
				break;
			case 'notifications/tasks/status':
				bus.emit('task_status', { task: p?.task as McpTask });
				break;
			case '_transport/closed':
				// Internal signal from stdio transport on unexpected exit
				if (state === 'connected') {
					setState('error');
					bus.emit('disconnected', { reason: String(p?.reason ?? 'transport closed') });
					rejectAllPending(new McpConnectionError('Transport closed unexpectedly'));
				}
				break;
			default:
				bus.emit('notification', { method, params });
		}
	};

	const sendRaw = (msg: Parameters<typeof transport.send>[0]): Promise<unknown> => transport.send(msg);

	const sendRequest = <T = unknown>(
		msg: Parameters<typeof transport.send>[0],
		opts?: { signal?: AbortSignal; onProgress?: PendingRequest['onProgress']; progressToken?: string | number },
	): Promise<T> => {
		return new Promise<T>((resolve, reject) => {
			const id = msg.id;
			if (id === undefined) {
				reject(new McpProtocolError('sendRequest called with a message that has no id'));
				return;
			}
			const timeoutMs = defaultTimeout;

			const timeoutHandle = timeoutMs
				? setTimeout(() => {
						pending.delete(id);
						if (opts?.progressToken !== undefined) progressTokenToId.delete(opts.progressToken);
						reject(new McpTimeoutError(`Request timed out after ${timeoutMs}ms`));
					}, timeoutMs)
				: undefined;

			const entry: PendingRequest = {
				resolve: resolve as (v: unknown) => void,
				reject,
				timeoutHandle,
				onProgress: opts?.onProgress,
				progressToken: opts?.progressToken,
				signal: opts?.signal,
			};

			pending.set(id, entry);
			if (opts?.progressToken !== undefined) progressTokenToId.set(opts.progressToken, id);

			if (opts?.signal) {
				opts.signal.addEventListener(
					'abort',
					() => {
						if (!pending.has(id)) return;
						const p = pending.get(id);
						clearTimeout(p?.timeoutHandle);
						pending.delete(id);
						if (opts.progressToken !== undefined) progressTokenToId.delete(opts.progressToken);

						if (entry.taskId) {
							// Task-augmented: send tasks/cancel
							const cancelId = nextRequestId();
							transport.send(buildTasksCancelRequest(cancelId, entry.taskId)).catch(() => undefined);
						} else {
							// Normal: send notifications/cancelled
							transport.send(buildCancelNotification(id)).catch(() => undefined);
						}

						reject(new DOMException('Aborted', 'AbortError'));
					},
					{ once: true },
				);
			}

			transport.send(msg).catch((err: unknown) => {
				if (pending.has(id)) {
					clearTimeout(timeoutHandle);
					pending.delete(id);
					if (opts?.progressToken !== undefined) progressTokenToId.delete(opts.progressToken);
					reject(err);
				}
			});
		});
	};

	const stopKeepalive = (): void => {
		if (keepAliveHandle !== null) {
			clearInterval(keepAliveHandle);
			keepAliveHandle = null;
		}
	};

	const startKeepalive = (): void => {
		if (!keepAlive) return;
		keepAliveHandle = setInterval(async () => {
			try {
				await client.ping();
			} catch {
				stopKeepalive();
				setState('error');
				bus.emit('error', { error: new McpTimeoutError('Keepalive ping timed out') });
				await client.disconnect().catch(() => undefined);
			}
		}, keepAlive.intervalMs);
	};

	const doConnect = async (): Promise<McpServerInfo> => {
		await transport.connect();
		unsubscribeTransport = transport.onMessage(handleMessage);

		const capabilities = deriveClientCapabilities(handlers, options.capabilities);
		let initParams = buildInitializeParams(capabilities, options.clientInfo);
		if (hooks.beforeInitialize) initParams = await hooks.beforeInitialize(initParams);

		const id = nextRequestId();
		const response = await sendRequest<{
			protocolVersion: string;
			serverInfo: { name: string; version: string; title?: string; instructions?: string };
			capabilities: McpServerInfo['capabilities'];
		}>(buildInitializeRequest(id, initParams));

		if (!response?.serverInfo) {
			throw new McpHandshakeError('Invalid initialize response: missing serverInfo');
		}

		if (response.protocolVersion !== MCP_PROTOCOL_VERSION) {
			// Accept older minor versions but warn; spec says clients MUST support the negotiated version
		}

		serverInfo = {
			name: response.serverInfo.name,
			version: response.serverInfo.version,
			title: response.serverInfo.title,
			instructions: response.serverInfo.instructions,
			capabilities: response.capabilities ?? {},
		};

		if (hooks.afterInitialize) await hooks.afterInitialize(serverInfo);

		await sendRaw(buildInitializedNotification());

		return serverInfo;
	};

	const client: McpClient = {
		async connect(): Promise<McpServerInfo> {
			if (state !== 'idle' && state !== 'disconnected') {
				throw new McpConnectionError(`Cannot connect from state: ${state}`);
			}
			setState('connecting');
			bus.emit('connecting', {});
			try {
				const info = await doConnect();
				setState('connected');
				bus.emit('connected', { serverInfo: info });
				startKeepalive();
				return info;
			} catch (err) {
				setState('error');
				unsubscribeTransport?.();
				unsubscribeTransport = null;
				throw err;
			}
		},

		async disconnect(): Promise<void> {
			if (state === 'disconnected' || state === 'disconnecting') return;
			setState('disconnecting');
			stopKeepalive();
			rejectAllPending(new McpConnectionError('Client disconnected'));
			unsubscribeTransport?.();
			unsubscribeTransport = null;
			try {
				await transport.disconnect();
			} finally {
				setState('disconnected');
				serverInfo = null;
				bus.emit('disconnected', {});
			}
		},

		async restart(): Promise<McpServerInfo> {
			setState('restarting');
			bus.emit('restarting', {});
			stopKeepalive();
			rejectAllPending(new McpConnectionError('Client restarting'));
			unsubscribeTransport?.();
			unsubscribeTransport = null;
			await transport.disconnect().catch(() => undefined);

			setState('connecting');
			bus.emit('connecting', {});
			try {
				const info = await doConnect();
				setState('connected');
				bus.emit('restarted', { serverInfo: info });
				startKeepalive();
				return info;
			} catch (err) {
				setState('error');
				throw err;
			}
		},

		async ping(): Promise<void> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			await sendRequest(buildPingRequest(id));
		},

		async notifyRootsChanged(): Promise<void> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			if (!handlers.onRootsList) {
				throw new McpCapabilityError(
					'Client did not register onRootsList handler — roots capability not advertised',
				);
			}
			await sendRaw(buildRootsChangedNotification());
		},

		async listToolsPage(cursor?: string): Promise<{ tools: McpTool[]; nextCursor?: string }> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			const response = await callWithRetry(
				() =>
					sendRequest<{ tools: Array<Record<string, unknown>>; nextCursor?: string }>(
						buildToolsListRequest(id, cursor),
					),
				retryPolicy,
			);
			const tools: McpTool[] = (response.tools ?? []).map((t) => ({
				serverName: '',
				name: String(t.name ?? ''),
				title: t.title !== undefined ? String(t.title) : undefined,
				description: t.description !== undefined ? String(t.description) : undefined,
				inputSchema: t.inputSchema,
				outputSchema: t.outputSchema,
				annotations: t.annotations as McpTool['annotations'],
				execution: t.execution as McpTool['execution'],
			}));
			return { tools, nextCursor: response.nextCursor };
		},

		async listTools(): Promise<McpTool[]> {
			const all: McpTool[] = [];
			let cursor: string | undefined;
			do {
				const page = await client.listToolsPage(cursor);
				all.push(...page.tools);
				cursor = page.nextCursor;
			} while (cursor !== undefined);
			return all;
		},

		async callTool(
			name: string,
			args: Record<string, unknown>,
			callOptions?: McpCallOptions,
		): Promise<McpCallResult> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');

			const resolvedArgs = hooks.beforeToolCall ? await hooks.beforeToolCall(name, args) : args;
			bus.emit('tool_call', { name, args: resolvedArgs });

			const progressToken = callOptions?.onProgress ? nextRequestId() : undefined;
			const id = nextRequestId();

			const doCall = async (): Promise<McpCallResult> => {
				if (callOptions?.task) {
					// Task-augmented execution
					const createTaskResponse = await sendRequest<{ taskId?: string; id?: string }>(
						buildToolCallRequest(id, name, resolvedArgs, {
							progressToken,
							task: callOptions.task,
						}),
						{ signal: callOptions.signal, onProgress: callOptions.onProgress, progressToken },
					);

					const taskId = createTaskResponse?.taskId ?? createTaskResponse?.id;
					if (!taskId) {
						// Server responded synchronously (non-task path)
						return createTaskResponse as unknown as McpCallResult;
					}

					// Mark the pending entry with taskId for cancellation routing
					const pendEntry = pending.get(id);
					if (pendEntry) pendEntry.taskId = taskId;

					// Poll until terminal state
					let task: McpTask;
					do {
						const pollId = nextRequestId();
						task = await sendRequest<McpTask>(buildTasksGetRequest(pollId, taskId));
						bus.emit('task_status', { task });
						if (!TERMINAL_TASK_STATES.includes(task.status)) {
							await new Promise<void>((r) => setTimeout(r, 1000));
						}
					} while (!TERMINAL_TASK_STATES.includes(task.status));

					if (task.status === 'cancelled') {
						throw new McpProtocolError('Task was cancelled');
					}
					if (task.status === 'failed') {
						throw new McpProtocolError('Task failed');
					}

					const resultId = nextRequestId();
					return sendRequest<McpCallResult>(buildTasksResultRequest(resultId, taskId));
				}

				return sendRequest<McpCallResult>(buildToolCallRequest(id, name, resolvedArgs, { progressToken }), {
					signal: callOptions?.signal,
					onProgress: callOptions?.onProgress,
					progressToken,
				});
			};

			try {
				let result = await callWithRetry(doCall, retryPolicy);
				if (hooks.afterToolCall) result = await hooks.afterToolCall(name, result);
				bus.emit('tool_result', { name, result });
				return result;
			} catch (err) {
				bus.emit('tool_error', { name, error: err });
				throw err;
			}
		},

		async complete(
			ref: McpCompletionRef,
			argument: { name: string; value: string },
			context?: { arguments?: Record<string, string> },
		) {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			if (!serverInfo?.capabilities.completions) {
				throw new McpCapabilityError('Server does not support completions');
			}
			const id = nextRequestId();
			const response = await sendRequest<{ completion: { values: string[]; total?: number; hasMore?: boolean } }>(
				buildCompletionRequest(id, ref, argument, context),
			);
			return response.completion ?? { values: [] };
		},

		async setLogLevel(level: McpLogLevel): Promise<void> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			if (!serverInfo?.capabilities.logging) {
				throw new McpCapabilityError('Server does not support logging');
			}
			const id = nextRequestId();
			await sendRequest(buildLoggingSetLevelRequest(id, level));
		},

		async listTasks(): Promise<McpTask[]> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			const response = await sendRequest<{ tasks: McpTask[] }>(buildTasksListRequest(id));
			return response.tasks ?? [];
		},

		async getTask(taskId: string): Promise<McpTask> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			return sendRequest<McpTask>(buildTasksGetRequest(id, taskId));
		},

		async getTaskResult(taskId: string): Promise<McpCallResult> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			return sendRequest<McpCallResult>(buildTasksResultRequest(id, taskId));
		},

		async cancelTask(taskId: string): Promise<McpTask> {
			if (state !== 'connected') throw new McpConnectionError('Not connected');
			const id = nextRequestId();
			return sendRequest<McpTask>(buildTasksCancelRequest(id, taskId));
		},

		getState(): McpClientState {
			return state;
		},

		bus,
	};

	return client;
};
