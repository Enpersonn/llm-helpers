import type { Bus } from '@llm-helpers/core';
import type { RetryPolicy } from '@llm-helpers/core';

export type { Bus, RetryPolicy };

// ─── JSON-RPC ────────────────────────────────────────────────────────────────

export type JsonRpcMessage = {
	jsonrpc: '2.0';
	id?: string | number;
	method?: string;
	params?: unknown;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
};

export type McpTransport = {
	connect(): Promise<void>;
	disconnect(): Promise<void>;
	send(message: JsonRpcMessage): Promise<void>;
	onMessage(handler: (message: JsonRpcMessage) => void): () => void;
};

// ─── Client state ────────────────────────────────────────────────────────────

export type McpClientState =
	| 'idle'
	| 'connecting'
	| 'connected'
	| 'restarting'
	| 'disconnecting'
	| 'disconnected'
	| 'error';

// ─── Server info ─────────────────────────────────────────────────────────────

export type McpServerCapabilities = {
	tools?: { listChanged?: boolean };
	resources?: { subscribe?: boolean; listChanged?: boolean };
	prompts?: { listChanged?: boolean };
	logging?: Record<string, never>;
	completions?: Record<string, never>;
	tasks?: { requests?: { tools?: { call?: Record<string, never> } } };
	experimental?: Record<string, unknown>;
};

export type McpServerInfo = {
	name: string;
	version: string;
	title?: string;
	instructions?: string;
	capabilities: McpServerCapabilities;
};

// ─── Client capabilities ─────────────────────────────────────────────────────

export type McpClientCapabilities = {
	roots?: { listChanged?: boolean };
	sampling?: { tools?: Record<string, never> };
	elicitation?: { form?: Record<string, never>; url?: Record<string, never> };
	tasks?: {
		requests?: {
			sampling?: { createMessage?: Record<string, never> };
			elicitation?: { create?: Record<string, never> };
		};
	};
	experimental?: Record<string, unknown>;
};

// ─── Server-to-client request types ──────────────────────────────────────────

export type McpRoot = {
	uri: string;
	name?: string;
};

export type SamplingRequest = {
	messages: Array<{ role: 'user' | 'assistant'; content: unknown }>;
	modelPreferences?: {
		hints?: Array<{ name?: string }>;
		costPriority?: number;
		speedPriority?: number;
		intelligencePriority?: number;
	};
	systemPrompt?: string;
	includeContext?: 'none' | 'thisServer' | 'allServers';
	maxTokens: number;
	tools?: McpTool[];
	toolChoice?: 'auto' | 'any' | { type: 'tool'; name: string };
};

export type SamplingResult = {
	role: 'assistant';
	content: McpContent | McpContent[];
	model?: string;
	stopReason?: 'endTurn' | 'maxTokens' | 'stopSequence' | 'toolUse' | string;
};

export type ElicitationFormRequest = {
	mode?: 'form';
	message: string;
	requestedSchema?: Record<string, unknown>;
};

export type ElicitationUrlRequest = {
	mode: 'url';
	message: string;
	url: string;
	elicitationId: string;
};

export type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

export type ElicitationResult = {
	action: 'accept' | 'decline' | 'cancel';
	content?: Record<string, unknown>;
};

// ─── Content types ────────────────────────────────────────────────────────────

export type McpResourceContent = {
	uri: string;
	mimeType?: string;
	text?: string;
	blob?: string;
};

export type McpContent =
	| { type: 'text'; text: string }
	| { type: 'image'; data: string; mimeType: string }
	| { type: 'audio'; data: string; mimeType: string }
	| { type: 'resource_link'; uri: string; mimeType?: string; name?: string; description?: string }
	| { type: 'resource'; resource: McpResourceContent }
	| { type: 'tool_use'; id: string; name: string; input: unknown }
	| { type: 'tool_result'; toolUseId: string; content: McpContent[]; isError?: boolean };

// ─── Completion types ─────────────────────────────────────────────────────────

export type McpCompletionRef =
	| { type: 'ref/prompt'; name: string }
	| { type: 'ref/resource'; uri: string };

export type McpCompletionResult = {
	values: string[];
	total?: number;
	hasMore?: boolean;
};

// ─── Per-call options ─────────────────────────────────────────────────────────

export type McpCallOptions = {
	signal?: AbortSignal;
	onProgress?: (progress: number, total?: number, message?: string) => void;
	task?: { ttl?: number };
};

// ─── Tool types ───────────────────────────────────────────────────────────────

export type McpToolAnnotations = {
	title?: string;
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
	openWorldHint?: boolean;
};

export type McpTool = {
	serverName: string;
	name: string;
	title?: string;
	description?: string;
	inputSchema?: unknown;
	outputSchema?: unknown;
	annotations?: McpToolAnnotations;
	execution?: { taskSupport?: 'forbidden' | 'optional' | 'required' };
};

export type McpCallResult = {
	content?: McpContent[];
	structuredContent?: Record<string, unknown>;
	isError?: boolean;
};

// ─── Tasks (experimental) ─────────────────────────────────────────────────────

export type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

export type McpTask = {
	id: string;
	description?: string;
	status: McpTaskStatus;
};

// ─── Log level ────────────────────────────────────────────────────────────────

export type McpLogLevel =
	| 'debug'
	| 'info'
	| 'notice'
	| 'warning'
	| 'error'
	| 'critical'
	| 'alert'
	| 'emergency';

// ─── Client options ───────────────────────────────────────────────────────────

export type McpClientHandlers = {
	onRootsList?: () => McpRoot[] | Promise<McpRoot[]>;
	onSampling?: (request: SamplingRequest) => SamplingResult | Promise<SamplingResult>;
	onElicitation?: (request: ElicitationFormRequest) => ElicitationResult | Promise<ElicitationResult>;
	onUrlElicitation?: (request: ElicitationUrlRequest) => void | Promise<void>;
};

export type InitializeParams = {
	protocolVersion: string;
	clientInfo: {
		name: string;
		version: string;
		title?: string;
		description?: string;
		websiteUrl?: string;
	};
	capabilities: McpClientCapabilities;
};

export type McpClientHooks = {
	beforeInitialize?: (params: InitializeParams) => InitializeParams | Promise<InitializeParams>;
	afterInitialize?: (info: McpServerInfo) => void | Promise<void>;
	beforeToolCall?: (
		name: string,
		args: Record<string, unknown>,
	) => Record<string, unknown> | Promise<Record<string, unknown>>;
	afterToolCall?: (name: string, result: McpCallResult) => McpCallResult | Promise<McpCallResult>;
};

export type McpClientOptions = {
	timeout?: number;
	retry?: RetryPolicy;
	capabilities?: McpClientCapabilities;
	handlers?: McpClientHandlers;
	hooks?: McpClientHooks;
	clientInfo?: {
		name: string;
		version: string;
		title?: string;
		description?: string;
		websiteUrl?: string;
	};
	keepAlive?: { intervalMs: number; timeoutMs: number };
};

// ─── Event maps ───────────────────────────────────────────────────────────────

export type McpClientEventMap = {
	connecting: Record<string, never>;
	connected: { serverInfo: McpServerInfo };
	disconnected: { reason?: string };
	restarting: Record<string, never>;
	restarted: { serverInfo: McpServerInfo };

	tool_call: { name: string; args: Record<string, unknown> };
	tool_result: { name: string; result: McpCallResult };
	tool_error: { name: string; error: unknown };

	tools_changed: Record<string, never>;
	resources_changed: Record<string, never>;
	resource_updated: { uri: string };
	prompts_changed: Record<string, never>;
	progress: {
		progressToken: string | number;
		progress: number;
		total?: number;
		message?: string;
	};
	log_message: { level: McpLogLevel; logger?: string; data: unknown };
	cancelled: { requestId: string | number; reason?: string };
	elicitation_complete: {
		elicitationId: string;
		action: 'accept' | 'decline' | 'cancel';
		content?: Record<string, unknown>;
	};
	task_status: { task: McpTask };

	notification: { method: string; params?: unknown };
	error: { error: unknown };
};

export type McpManagerEventMap = {
	server_added: { name: string };
	server_removed: { name: string };
	server_connected: { name: string; serverInfo: McpServerInfo };
	server_disconnected: { name: string; reason?: string };
	server_error: { name: string; error: unknown };
	server_tools_changed: { name: string };
	server_task_status: { name: string; task: McpTask };
};

// ─── Client interface ─────────────────────────────────────────────────────────

export type McpClient = {
	connect(): Promise<McpServerInfo>;
	disconnect(): Promise<void>;
	restart(): Promise<McpServerInfo>;
	ping(): Promise<void>;

	notifyRootsChanged(): Promise<void>;

	listTools(): Promise<McpTool[]>;
	listToolsPage(cursor?: string): Promise<{ tools: McpTool[]; nextCursor?: string }>;
	callTool(
		name: string,
		args: Record<string, unknown>,
		options?: McpCallOptions,
	): Promise<McpCallResult>;

	complete(
		ref: McpCompletionRef,
		argument: { name: string; value: string },
		context?: { arguments?: Record<string, string> },
	): Promise<McpCompletionResult>;

	setLogLevel(level: McpLogLevel): Promise<void>;

	listTasks(): Promise<McpTask[]>;
	getTask(id: string): Promise<McpTask>;
	getTaskResult(id: string): Promise<McpCallResult>;
	cancelTask(id: string): Promise<McpTask>;

	getState(): McpClientState;
	bus: Bus<McpClientEventMap>;
};

// ─── Manager interface ────────────────────────────────────────────────────────

export type McpManagerConfig = {
	servers: Record<string, { client: McpClient }>;
	autoConnect?: boolean;
};

export type McpManager = {
	connectAll(): Promise<void>;
	disconnectAll(): Promise<void>;
	connectServer(name: string): Promise<McpServerInfo>;
	disconnectServer(name: string): Promise<void>;
	restartServer(name: string): Promise<McpServerInfo>;

	addServer(name: string, client: McpClient): void;
	removeServer(name: string): Promise<void>;
	getServer(name: string): McpClient | undefined;
	getState(name: string): McpClientState | undefined;

	listTools(): Promise<McpTool[]>;
	callTool(params: {
		serverName: string;
		name: string;
		arguments: Record<string, unknown>;
		options?: McpCallOptions;
	}): Promise<McpCallResult>;

	bus: Bus<McpManagerEventMap>;
};

// ─── Auth types ───────────────────────────────────────────────────────────────

export type McpAuthToken = {
	accessToken: string;
	tokenType: 'Bearer';
	expiresAt?: number;
	scope?: string;
	refreshToken?: string;
};

export type TokenProvider = {
	getToken(): Promise<McpAuthToken>;
	refreshToken?(): Promise<McpAuthToken>;
	invalidate?(): void;
};

export type OAuthConfig = {
	resourceUrl: string;
	clientId?: string;
	clientMetadataUrl?: string;
	redirectUri?: string;
	scope?: string;
	openAuthUrl: (url: string) => void | Promise<void>;
	receiveAuthCode: () => Promise<{ code: string; state: string }>;
	tokenStore?: {
		load(): Promise<McpAuthToken | null>;
		save(token: McpAuthToken): Promise<void>;
		clear(): Promise<void>;
	};
	fetchImpl?: typeof fetch;
};
