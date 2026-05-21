/**
 * HTTP+SSE transport for MCP 2024-11-05 spec.
 * @deprecated Use createStreamableHttpTransport (MCP 2025-11-25) instead.
 */

import { McpAuthError, McpConnectionError, McpProtocolError } from '../core/errors.js';
import type { JsonRpcMessage, McpTransport, TokenProvider } from '../types.js';

type HttpTransportConfig = {
	url: string;
	headers?: Record<string, string>;
	auth?: TokenProvider;
	fetchImpl?: typeof fetch;
};

const MCP_PROTOCOL_VERSION = '2024-11-05';

const parseSseStream = async (
	body: ReadableStream<Uint8Array>,
	onMessage: (data: string, id?: string) => void,
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
				for (const line of event.split('\n')) {
					if (line.startsWith('data:')) data += (data ? '\n' : '') + line.slice(5).trimStart();
					else if (line.startsWith('id:')) id = line.slice(3).trimStart();
				}
				if (data) onMessage(data, id);
			}
		}
	} finally {
		reader.releaseLock();
	}
};

export const createHttpTransport = (config: HttpTransportConfig): McpTransport => {
	const { url, headers: extraHeaders = {}, auth, fetchImpl = fetch } = config;
	const messageHandlers = new Set<(msg: JsonRpcMessage) => void>();

	let lastEventId: string | null = null;
	let sseAbortController: AbortController | null = null;
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
		return h;
	};

	const fetchWithAuth = async (input: RequestInfo, init: RequestInit): Promise<Response> => {
		const res = await fetchImpl(input, init);
		if (res.status === 401 && auth?.refreshToken) {
			await auth.refreshToken();
			const refreshedHeaders = await buildHeaders(init.headers as Record<string, string>);
			const retried = await fetchImpl(input, { ...init, headers: refreshedHeaders });
			if (retried.status === 401) throw new McpAuthError('Authentication failed after token refresh');
			return retried;
		}
		if (res.status === 401) throw new McpAuthError('Authentication failed');
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
					const res = await fetchWithAuth(url, { method: 'GET', headers, signal });
					if (!res.ok || !res.body) break;

					await parseSseStream(
						res.body,
						(data, id) => {
							if (id !== undefined) lastEventId = id;
							try {
								const msg = JSON.parse(data) as JsonRpcMessage;
								dispatch(msg);
							} catch {
								// ignore malformed SSE data
							}
						},
						signal,
					);
				} catch {
					if (signal.aborted) break;
				}
				if (!signal.aborted) await new Promise<void>((r) => setTimeout(r, 1000));
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
		},

		async send(message: JsonRpcMessage) {
			const headers = await buildHeaders({
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
			});

			let res: Response;
			try {
				res = await fetchWithAuth(url, { method: 'POST', headers, body: JSON.stringify(message) });
			} catch (err) {
				throw new McpConnectionError(
					`HTTP request failed: ${err instanceof Error ? err.message : String(err)}`,
				);
			}

			if (!res.ok) {
				const text = await res.text().catch(() => '');
				throw new McpProtocolError(`Server error (${res.status}): ${text}`);
			}
			// In HTTP+SSE mode responses arrive via the SSE stream, not the POST response body
		},

		onMessage(handler: (msg: JsonRpcMessage) => void): () => void {
			messageHandlers.add(handler);
			return () => messageHandlers.delete(handler);
		},
	};
};
