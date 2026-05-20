import { createBus } from '@llm-helpers/core';
import type {
	McpCallOptions,
	McpCallResult,
	McpClient,
	McpClientState,
	McpManager,
	McpManagerConfig,
	McpManagerEventMap,
	McpServerInfo,
	McpTool,
} from '../types.js';
import { McpServerNotFoundError } from './errors.js';

export const createMcpManager = (config: McpManagerConfig): McpManager => {
	const bus = createBus<McpManagerEventMap>();
	const servers = new Map<string, { client: McpClient; unsubscribe: () => void }>();

	const subscribeToClient = (name: string, client: McpClient): (() => void) => {
		const onConnected = (payload: { serverInfo: McpServerInfo }): void => {
			bus.emit('server_connected', { name, serverInfo: payload.serverInfo });
		};
		const onDisconnected = (payload: { reason?: string }): void => {
			bus.emit('server_disconnected', { name, reason: payload.reason });
		};
		const onError = (payload: { error: unknown }): void => {
			bus.emit('server_error', { name, error: payload.error });
		};
		const onToolsChanged = (): void => {
			bus.emit('server_tools_changed', { name });
		};
		const onTaskStatus = (payload: { task: import('../types.js').McpTask }): void => {
			bus.emit('server_task_status', { name, task: payload.task });
		};

		client.bus.on('connected', onConnected);
		client.bus.on('disconnected', onDisconnected);
		client.bus.on('error', onError);
		client.bus.on('tools_changed', onToolsChanged);
		client.bus.on('task_status', onTaskStatus);

		return () => {
			client.bus.off('connected', onConnected);
			client.bus.off('disconnected', onDisconnected);
			client.bus.off('error', onError);
			client.bus.off('tools_changed', onToolsChanged);
			client.bus.off('task_status', onTaskStatus);
		};
	};

	// Register initial servers
	for (const [name, { client }] of Object.entries(config.servers)) {
		const unsubscribe = subscribeToClient(name, client);
		servers.set(name, { client, unsubscribe });
	}

	const getClientOrThrow = (name: string): McpClient => {
		const entry = servers.get(name);
		if (!entry) throw new McpServerNotFoundError(name);
		return entry.client;
	};

	const manager: McpManager = {
		async connectAll(): Promise<void> {
			await Promise.all([...servers.entries()].map(([, { client }]) => client.connect()));
		},

		async disconnectAll(): Promise<void> {
			await Promise.all([...servers.entries()].map(([, { client }]) => client.disconnect()));
		},

		async connectServer(name: string): Promise<McpServerInfo> {
			return getClientOrThrow(name).connect();
		},

		async disconnectServer(name: string): Promise<void> {
			return getClientOrThrow(name).disconnect();
		},

		async restartServer(name: string): Promise<McpServerInfo> {
			return getClientOrThrow(name).restart();
		},

		addServer(name: string, client: McpClient): void {
			const existing = servers.get(name);
			if (existing) {
				existing.unsubscribe();
			}
			const unsubscribe = subscribeToClient(name, client);
			servers.set(name, { client, unsubscribe });
			bus.emit('server_added', { name });
		},

		async removeServer(name: string): Promise<void> {
			const entry = servers.get(name);
			if (!entry) return;
			entry.unsubscribe();
			await entry.client.disconnect().catch(() => undefined);
			servers.delete(name);
			bus.emit('server_removed', { name });
		},

		getServer(name: string): McpClient | undefined {
			return servers.get(name)?.client;
		},

		getState(name: string): McpClientState | undefined {
			return servers.get(name)?.client.getState();
		},

		async listTools(): Promise<McpTool[]> {
			const results = await Promise.all(
				[...servers.entries()]
					.filter(([, { client }]) => client.getState() === 'connected')
					.map(async ([name, { client }]) => {
						const tools = await client.listTools();
						return tools.map((t) => ({ ...t, serverName: name }));
					}),
			);
			return results.flat();
		},

		async callTool(params: {
			serverName: string;
			name: string;
			arguments: Record<string, unknown>;
			options?: McpCallOptions;
		}): Promise<McpCallResult> {
			const client = getClientOrThrow(params.serverName);
			return client.callTool(params.name, params.arguments, params.options);
		},

		bus,
	};

	return manager;
};
