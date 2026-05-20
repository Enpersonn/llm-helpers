import type { JsonRpcMessage, McpTransport, TokenProvider } from '../types.js';
import { McpAuthError, McpConnectionError, McpProtocolError, McpSessionExpiredError } from '../core/errors.js';

type StreamableHttpTransportConfig = {
	url: string;
	headers?: Record<string, string>;
	auth?: TokenProvider;
	fetchImpl?: typeof fetch;
};

const MCP_PROTOCOL_VERSION = '2025-11-25';

const parseSseStream = async (
	body: ReadableStream<Uint8Array>,
	onMessage: (data: string, id?: string, retry?: number) => void,
	signal?: AbortSignal,
): Promise<void> => {
	const reader = body.getReader();
	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (true) {
			if (signal?.aborted) break;
			const { done, value } = await reader.read();
			if (done) break;
			buffer += decoder.decode(value, { stream: true });

			const events = buffer.split('\n\n');
			buffer = events.pop() ?? '';

			for (const event of events) {
				let data = '';
				let id: string | undefined;
				let retry: number | undefined;

				for (const line of event.split('\n')) {
					if (line.startsWith('data:')) {
						data += (data ? '\n' : '') + line.slice(5).trimStart();
					} else if (line.startsWith('id:')) {
						id = line.slice(3).trimStart();
					} else if (line.startsWith('retry:')) {
						const ms = parseInt(line.slice(6).trimStart(), 10);
						if (!isNaN(ms)) retry = ms;
					}
				}

				if (data) onMessage(data, id, retry);
			}
		}
	} finally {
		reader.releaseLock();
	}
};

export const createStreamableHttpTransport = (config: StreamableHttpTransportConfig): McpTransport => {
	const { url, headers: extraHeaders = {}, auth, fetchImpl = fetch } = config;
	const messageHandlers = new Set<(msg: JsonRpcMessage) => void>();

	let sessionId: string | null = null;
	let lastEventId: string | null = null;
	let sseAbortController: AbortController | null = null;
	let sseRetryMs = 0;
	let connected = false;

	const dispatch = (msg: JsonRpcMessage): void => {
		for (const h of messageHandlers) {
			try {
				h(msg);
			} catch {
				// ignore
			}
		}
	};

	const buildHeaders = async (extra?: Record<string, string>): Promise<Record<string, string>> => {
		const h: Record<string, string> = {
			'MCP-Protocol-Version': MCP_PROTOCOL_VERSION,
			...extraHeaders,
			...extra,
		};
		if (auth) {
			const token = await auth.getToken();
			h['Authorization'] = `Bearer ${token.accessToken}`;
		}
		if (sessionId) h['MCP-Session-Id'] = sessionId;
		return h;
	};

	const fetchWithAuth = async (
		input: RequestInfo,
		init: RequestInit,
		retryOn401 = true,
	): Promise<Response> => {
		const res = await fetchImpl(input, init);
		if (res.status === 401 && retryOn401 && auth?.refreshToken) {
			await auth.refreshToken();
			const refreshedHeaders = await buildHeaders(init.headers as Record<string, string>);
			return fetchImpl(input, { ...init, headers: refreshedHeaders });
		}
		if (res.status === 401) throw new McpAuthError('Authentication failed after token refresh');
		return res;
	};

	const startSseListener = (): void => {
		sseAbortController = new AbortController();
		const signal = sseAbortController.signal;

		const run = async (): Promise<void> => {
			while (!signal.aborted) {
				try {
					const headers = await buildHeaders({
						Accept: 'text/event-stream',
						...(lastEventId !== null ? { 'Last-Event-ID': lastEventId } : {}),
					});
					const res = await fetchWithAuth(url, { method: 'GET', headers, signal }, true);
					if (!res.ok || !res.body) break;

					await parseSseStream(
						res.body,
						(data, id, retry) => {
							if (id !== undefined) lastEventId = id;
							if (retry !== undefined) sseRetryMs = retry;
							try {
								const msg = JSON.parse(data) as JsonRpcMessage;
								dispatch(msg);
							} catch {
								// malformed SSE data — ignore
							}
						},
						signal,
					);
				} catch (err) {
					if (signal.aborted) break;
					// reconnect after retry delay
				}

				if (!signal.aborted) {
					await new Promise<void>((resolve) => setTimeout(resolve, sseRetryMs || 1000));
				}
			}
		};

		run().catch(() => {
			// background SSE listener — errors don't propagate
		});
	};

	return {
		async connect() {
			if (connected) return;
			connected = true;
			startSseListener();
		},

		async disconnect() {
			if (!connected) return;
			connected = false;

			sseAbortController?.abort();
			sseAbortController = null;

			if (sessionId) {
				try {
					const headers = await buildHeaders();
					await fetchImpl(url, { method: 'DELETE', headers });
				} catch {
					// best-effort session teardown
				}
				sessionId = null;
			}
		},

		async send(message: JsonRpcMessage) {
			const headers = await buildHeaders({
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			});

			const body = JSON.stringify(message);
			let res: Response;

			try {
				res = await fetchWithAuth(url, { method: 'POST', headers, body });
			} catch (err) {
				throw new McpConnectionError(`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`);
			}

			if (res.status === 404 && sessionId) {
				sessionId = null;
				throw new McpSessionExpiredError();
			}

			if (res.status === 400) {
				const text = await res.text().catch(() => '');
				throw new McpProtocolError(`Server rejected request (400): ${text}`);
			}

			// Capture session ID from initialization response
			const newSessionId = res.headers.get('MCP-Session-Id');
			if (newSessionId) sessionId = newSessionId;

			if (!res.ok) return;

			const contentType = res.headers.get('Content-Type') ?? '';

			if (contentType.includes('text/event-stream') && res.body) {
				// Response carries SSE stream — parse inline responses
				await parseSseStream(res.body, (data, id) => {
					if (id !== undefined) lastEventId = id;
					try {
						const msg = JSON.parse(data) as JsonRpcMessage;
						dispatch(msg);
					} catch {
						// ignore
					}
				});
			} else if (contentType.includes('application/json')) {
				const text = await res.text();
				if (text.trim()) {
					try {
						const msg = JSON.parse(text) as JsonRpcMessage;
						dispatch(msg);
					} catch {
						throw new McpProtocolError(`Malformed JSON response: ${text}`);
					}
				}
			}
		},

		onMessage(handler: (msg: JsonRpcMessage) => void): () => void {
			messageHandlers.add(handler);
			return () => messageHandlers.delete(handler);
		},
	};
};
