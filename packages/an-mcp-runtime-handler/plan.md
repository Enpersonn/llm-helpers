# `@llm-helpers/an-mcp-runtime-handler` — Architecture Plan

**Spec target:** MCP 2025-11-25

## Design philosophy

Consistent with the rest of the monorepo:

- **Factory functions only** — `createMcpClient(transport, options)`, never classes or `new`
- **Interface first** — the package defines the minimal contracts; users implement or use the built-in adapters
- **Transport is the seam** — core protocol logic is transport-agnostic; stdio/HTTP are pluggable adapters, not baked in
- **Auth is a provider** — a `TokenProvider` interface is the auth seam; the transport consumes it, the user chooses the implementation
- **Handlers are the seam for server-to-client requests** — when the server initiates a request (sampling, elicitation, roots), the client dispatches to a caller-supplied handler; undeclared capabilities are simply not advertised
- **Bus + hooks** — same observable pattern as `an-agent-runtime-handler`: a typed event bus on the returned object, lifecycle hooks in options
- **Composable output** — `McpManager` intentionally satisfies the `McpRuntime` interface that `@llm-helpers/tools` already expects, so the full stack composes without glue code
- **Manager = MCP Host** — in MCP spec terminology, `McpManager` is the Host: it owns all client connections, enforces capability policy, and is the right place to implement user-consent flows

---

## Folder structure

```
src/
  types.ts              ← all shared types (transport, client, manager, auth, event maps, state)
  core/
    client.ts           ← createMcpClient(transport, options) → McpClient
    manager.ts          ← createMcpManager(config) → McpManager
    protocol.ts         ← JSON-RPC message builders, MCP initialize handshake logic
    errors.ts           ← McpError hierarchy
  transports/
    stdio.ts            ← createStdioTransport({ command, args, env })
    stdio-helpers.ts    ← createNpxStdioTransport, createUvxStdioTransport, createDockerStdioTransport
    http.ts             ← createHttpTransport({ url, headers })  (HTTP+SSE, MCP 2024-11-05, deprecated)
    streamable.ts       ← createStreamableHttpTransport({ url }) (Streamable HTTP, MCP 2025-11-25)
  auth/
    static.ts           ← createStaticTokenProvider(token) — API keys / fixed tokens
    oauth.ts            ← createOAuthTokenProvider(config) — full OAuth 2.1 + PKCE flow
    discovery.ts        ← discoverAuthServer(resourceUrl) — RFC 9728 + RFC 8414 helpers
  index.ts              ← public surface
```

---

## Core types (`types.ts`)

### Transport

The raw message-passing seam. Swap the whole transport without touching any protocol logic.

```ts
type JsonRpcMessage = {
  jsonrpc: '2.0';
  id?: string | number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpTransport = {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  send(message: JsonRpcMessage): Promise<void>;
  onMessage(handler: (message: JsonRpcMessage) => void): () => void; // returns unsubscribe
};
```

### Client state

```ts
type McpClientState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'restarting'
  | 'disconnecting'
  | 'disconnected'
  | 'error';
```

### Server info returned after handshake

```ts
type McpServerCapabilities = {
  tools?:       { listChanged?: boolean };
  resources?:   { subscribe?: boolean; listChanged?: boolean };
  prompts?:     { listChanged?: boolean };
  logging?:     {};          // server can emit log notifications and accept logging/setLevel
  completions?: {};          // server supports completion/complete
  tasks?:       { requests?: { tools?: { call?: {} } } }; // experimental: server accepts task-augmented tool calls
  experimental?: Record<string, unknown>;
};

type McpServerInfo = {
  name:          string;
  version:       string;
  title?:        string;       // human-readable display name (may differ from name)
  instructions?: string;       // optional guidance for interacting with this server
  capabilities:  McpServerCapabilities;
};
```

### Client capabilities (sent to server during handshake)

These are advertised in the `initialize` request. Only capabilities with a registered handler (or an explicitly enabled flag) are included — advertising a capability without handling the server's follow-up requests is a protocol violation.

```ts
type McpClientCapabilities = {
  roots?: {
    listChanged?: boolean; // client will send notifications/roots/list_changed when roots change
  };
  sampling?: {
    tools?: {}; // client supports tool-use within sampling responses (2025-11-25)
  };
  elicitation?: {
    form?: {}; // client can handle form-mode elicitation (auto-enabled if onElicitation is registered)
    url?:  {}; // client can handle URL-mode elicitation (auto-enabled if onUrlElicitation is registered)
  };
  tasks?: {
    requests?: {
      sampling?:    { createMessage?: {} }; // experimental: client can receive task-augmented sampling requests
      elicitation?: { create?: {} };         // experimental: client can receive task-augmented elicitation requests
    };
  };
  experimental?: Record<string, unknown>;
};
```

The client derives the actual sent capabilities from which handlers are registered in `McpClientOptions.handlers`, not from this type directly — the type is the shape of what gets serialised.

### Server-to-client request types

When the server exercises a declared capability it sends a request back to the client. Each must be answered.

```ts
type McpRoot = {
  uri: string;  // MUST be a file:// URI per the spec
  name?: string;
};

type SamplingRequest = {
  messages:          Array<{ role: 'user' | 'assistant'; content: unknown }>;
  modelPreferences?: {
    hints?:                Array<{ name?: string }>;
    costPriority?:         number;
    speedPriority?:        number;
    intelligencePriority?: number;
  };
  systemPrompt?:     string;
  includeContext?:   'none' | 'thisServer' | 'allServers'; // soft-deprecated in 2025-11-25 but still in schema
  maxTokens:         number;
  tools?:            McpTool[];      // 2025-11-25: tools the LLM should have available
  toolChoice?:       'auto' | 'any' | { type: 'tool'; name: string }; // 2025-11-25
};

type SamplingResult = {
  role:        'assistant';
  content:     McpContent | McpContent[]; // 2025-11-25: may be an array for multi-turn tool use
  model?:      string;
  stopReason?: 'endTurn' | 'maxTokens' | 'stopSequence' | 'toolUse' | string; // toolUse added 2025-11-25
};

// Form-mode elicitation — server requests structured user input
type ElicitationFormRequest = {
  mode?:            'form'; // optional; 'form' is the default if omitted
  message:          string;
  requestedSchema?: Record<string, unknown>; // restricted JSON Schema (no $ref, no nested objects beyond one level)
};

// URL-mode elicitation — server directs user to a URL; completion arrives via notification
type ElicitationUrlRequest = {
  mode:          'url';
  message:       string;
  url:           string;     // the URL to open
  elicitationId: string;     // correlation ID; will appear in notifications/elicitation/complete
};

type ElicitationRequest = ElicitationFormRequest | ElicitationUrlRequest;

type ElicitationResult = {
  action:   'accept' | 'decline' | 'cancel';
  content?: Record<string, unknown>; // present when action === 'accept' (form mode only)
};
```

### Content types

```ts
type McpContent =
  | { type: 'text';          text: string }
  | { type: 'image';         data: string; mimeType: string }     // base64-encoded
  | { type: 'audio';         data: string; mimeType: string }     // base64-encoded; 2025-11-25
  | { type: 'resource_link'; uri: string; mimeType?: string; name?: string; description?: string } // 2025-11-25
  | { type: 'resource';      resource: McpResourceContent }       // embedded resource; v2 but in spec
  | { type: 'tool_use';      id: string; name: string; input: unknown }          // in sampling responses
  | { type: 'tool_result';   toolUseId: string; content: McpContent[]; isError?: boolean }; // in sampling
```

### Completion types

```ts
type McpCompletionRef =
  | { type: 'ref/prompt';   name: string }
  | { type: 'ref/resource'; uri: string };

type McpCompletionResult = {
  values:   string[];
  total?:   number;   // total completions available (may exceed values.length)
  hasMore?: boolean;
};
```

### Per-call options

```ts
type McpCallOptions = {
  signal?:     AbortSignal;                                  // abort → sends notifications/cancelled
  onProgress?: (progress: number, total?: number, message?: string) => void; // auto-generates unique progressToken
  task?:       { ttl?: number };                             // opt into task-augmented execution (experimental)
};
```

When `task` is set, the client sends `_meta.task.ttl` in the request params, receives a `CreateTaskResult` from the server, and internally polls until terminal state. `callTool` still resolves to `McpCallResult` — the polling is transparent. Use `task_status` bus events to observe intermediate states.

### Tool types

```ts
type McpTool = {
  serverName:    string;
  name:          string;
  title?:        string;           // human-readable display name (may differ from name)
  description?:  string;
  inputSchema?:  unknown;          // JSON Schema for arguments
  outputSchema?: unknown;          // JSON Schema for structuredContent in results (2025-11-25)
  annotations?:  McpToolAnnotations;
  execution?:    { taskSupport?: 'forbidden' | 'optional' | 'required' }; // experimental
};

type McpToolAnnotations = {
  title?:           string;
  readOnlyHint?:    boolean; // tool does not modify external state
  destructiveHint?: boolean; // tool may perform irreversible actions
  idempotentHint?:  boolean; // calling N times = calling once
  openWorldHint?:   boolean; // tool may interact with external/unknown systems
};

// IMPORTANT: annotations are UNTRUSTED unless the server is explicitly trusted

type McpCallResult = {
  content?:           McpContent[];
  structuredContent?: Record<string, unknown>; // validated against tool's outputSchema if present
  isError?:           boolean;                 // defaults to false
};
```

### Tasks (experimental — MCP 2025-11-25)

Tasks are a **polling-based deferred execution** mechanism. The requestor (client for tool calls, server for sampling/elicitation) adds `_meta.task.ttl` to any eligible request. The receiver returns a `CreateTaskResult` (a task ID) instead of the normal result. The requestor then polls until the task reaches a terminal state.

Tasks are marked as **experimental** in the 2025-11-25 spec — the design may change.

```ts
type McpTaskStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

type McpTask = {
  id:           string;
  description?: string;
  status:       McpTaskStatus;
};
```

`input_required` means the server needs additional input from the user — in practice this triggers a follow-up elicitation request from the server.

### Log level type

```ts
// Full syslog severity scale (RFC 5424) — MCP uses all 8 levels
type McpLogLevel = 'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency';
```

### Client options and hooks

```ts
type McpClientOptions = {
  timeout?:      number;
  retry?:        RetryPolicy;           // same shape as an-agent-runtime-handler
  capabilities?: McpClientCapabilities; // advertised in initialize; auto-derived from handlers if omitted
  handlers?:     McpClientHandlers;
  hooks?:        McpClientHooks;
  clientInfo?:   {
    name:         string;
    version:      string;
    title?:       string;       // human-readable name
    description?: string;
    websiteUrl?:  string;
  };
  keepAlive?:    { intervalMs: number; timeoutMs: number }; // periodic client→server pings; disconnects on timeout
};

// Server-to-client request handlers — registering one auto-enables the matching capability
type McpClientHandlers = {
  onRootsList?:      () => McpRoot[] | Promise<McpRoot[]>;
  onSampling?:       (request: SamplingRequest) => SamplingResult | Promise<SamplingResult>;
  onElicitation?:    (request: ElicitationFormRequest) => ElicitationResult | Promise<ElicitationResult>;
  onUrlElicitation?: (request: ElicitationUrlRequest) => void | Promise<void>; // open the URL; completion arrives via notifications/elicitation/complete
};

// Outgoing request lifecycle hooks
type McpClientHooks = {
  beforeInitialize?: (params: InitializeParams) => InitializeParams | Promise<InitializeParams>;
  afterInitialize?:  (info: McpServerInfo) => void | Promise<void>;
  beforeToolCall?:   (name: string, args: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
  afterToolCall?:    (name: string, result: McpCallResult) => McpCallResult | Promise<McpCallResult>;
};
```

### Event maps

All known server-initiated notifications surface as typed events. Truly unknown or extension notifications fall through to `notification`. v2-only events are marked.

```ts
type McpClientEventMap = {
  // Lifecycle
  connecting:    {};
  connected:     { serverInfo: McpServerInfo };
  disconnected:  { reason?: string };
  restarting:    {};
  restarted:     { serverInfo: McpServerInfo };

  // Tool observability
  tool_call:     { name: string; args: Record<string, unknown> };
  tool_result:   { name: string; result: McpCallResult };
  tool_error:    { name: string; error: unknown };

  // Typed server→client notifications
  tools_changed:        {};
  resources_changed:    {};                                    // [v2] re-call listResources()
  resource_updated:     { uri: string };                       // [v2] subscribed resource updated
  prompts_changed:      {};                                    // [v2] re-call listPrompts()
  progress:             { progressToken: string | number; progress: number; total?: number; message?: string };
  log_message:          { level: McpLogLevel; logger?: string; data: unknown };
  cancelled:            { requestId: string | number; reason?: string };
  elicitation_complete: { elicitationId: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, unknown> }; // URL-mode elicitation resolved
  task_status:          { task: McpTask };                     // experimental

  // Fallback for unknown / extension notifications
  notification:  { method: string; params?: unknown };

  error:         { error: unknown };
};

type McpManagerEventMap = {
  server_added:          { name: string };
  server_removed:        { name: string };
  server_connected:      { name: string; serverInfo: McpServerInfo };
  server_disconnected:   { name: string; reason?: string };
  server_error:          { name: string; error: unknown };
  server_tools_changed:  { name: string }; // proxied from client — trigger re-aggregation
  server_task_status:    { name: string; task: McpTask }; // experimental
};
```

---

## Notification handling

The client categorises every inbound message from the transport:

1. **Response** (`id` present, no `method`) — correlates to a pending request in the request map and resolves/rejects it.
2. **Server-to-client request** (`id` + `method` present) — dispatched to the registered handler in `McpClientHandlers`. If no handler is registered the client sends a JSON-RPC `MethodNotFound` error response. The client will not have advertised the capability without a handler, so this is a defensive path only. Server `ping` requests are answered automatically with no handler required.
3. **Known notification** (`method` present, no `id`, method is in the known list) — emitted as the corresponding typed bus event.
4. **Unknown notification** — emitted as `notification` so extension protocols are not silently dropped.

Known notification method → event mapping:

| JSON-RPC method | Bus event | Notes |
|---|---|---|
| `notifications/tools/list_changed` | `tools_changed` | |
| `notifications/resources/list_changed` | `resources_changed` | *(v2)* |
| `notifications/resources/updated` | `resource_updated` | *(v2)* |
| `notifications/prompts/list_changed` | `prompts_changed` | *(v2)* |
| `notifications/progress` | `progress` | also routed to `McpCallOptions.onProgress` callback by token |
| `notifications/message` | `log_message` | |
| `notifications/cancelled` | `cancelled` | also aborts the matching pending request |
| `notifications/elicitation/complete` | `elicitation_complete` | URL-mode elicitation resolved |
| `notifications/tasks/status` | `task_status` | experimental |

Server-to-client *requests* (have an `id`, require a response):

| JSON-RPC method | Handler |
|---|---|
| `ping` | auto-answered (no handler needed) |
| `sampling/createMessage` | `onSampling` |
| `elicitation/create` (form mode) | `onElicitation` |
| `elicitation/create` (url mode) | `onUrlElicitation` |
| `roots/list` | `onRootsList` |

The manager subscribes to each client's `tools_changed` and `task_status` events, re-emitting them prefixed with the server name onto the manager bus.

---

## `createMcpClient` — single server connection (`core/client.ts`)

```ts
type McpClient = {
  // Lifecycle
  connect():    Promise<McpServerInfo>; // runs full MCP initialize handshake
  disconnect(): Promise<void>;
  restart():    Promise<McpServerInfo>; // disconnect → reconnect → re-handshake
  ping():       Promise<void>;          // sends a ping; resolves on pong; throws McpTimeoutError if no response

  // Roots
  notifyRootsChanged(): Promise<void>;  // sends notifications/roots/list_changed; only valid if listChanged: true was advertised

  // Tools
  listTools():                                                                        Promise<McpTool[]>;        // auto-paginates all pages
  listToolsPage(cursor?: string):                                                     Promise<{ tools: McpTool[]; nextCursor?: string }>;
  callTool(name: string, args: Record<string, unknown>, options?: McpCallOptions):    Promise<McpCallResult>;

  // Argument completion (for prompt args or resource URI templates)
  complete(
    ref:      McpCompletionRef,
    argument: { name: string; value: string },
    context?: { arguments?: Record<string, string> }, // previously-resolved args for multi-arg prompts
  ): Promise<McpCompletionResult>;

  // Logging control (only call if server declared logging capability)
  setLogLevel(level: McpLogLevel): Promise<void>;

  // Tasks — polling-based deferred execution (experimental; only available if server declared tasks capability)
  listTasks():                    Promise<McpTask[]>;
  getTask(id: string):            Promise<McpTask>;
  getTaskResult(id: string):      Promise<McpCallResult>;
  cancelTask(id: string):         Promise<McpTask>;  // returns the final task state

  getState(): McpClientState;
  bus:        Bus<McpClientEventMap>;
};

function createMcpClient(transport: McpTransport, options?: McpClientOptions): McpClient;
```

Internal responsibilities:

- **Pending request map** `id → { resolve, reject, timeoutHandle, onProgress?, signal? }` for JSON-RPC request/response correlation
- **State machine** guarded transitions (e.g. can't call `listTools` while `idle`)
- **`protocol.ts`** handles message construction: `initialize`, `initialized` notification, `tools/list`, `tools/call`, `ping`, `logging/setLevel`, `completion/complete`, `tasks/*`
- **Capability derivation** — build `clientCapabilities` from registered handlers, merged with any explicit `options.capabilities` overrides
- **Server-to-client request dispatch** — inbound requests routed to `options.handlers`; missing handlers reply with `MethodNotFound`
- **Ping responder** — auto-responds to server-initiated `ping` requests
- **Cancellation** — when a per-call `AbortSignal` fires, sends `notifications/cancelled` with the request's JSON-RPC ID and rejects the promise. For task-augmented requests, calls `tasks/cancel` instead (spec requirement)
- **Progress routing** — `notifications/progress` is matched against pending requests by `progressToken` to invoke the `onProgress` callback; then also emitted on the bus. `progressToken` values are generated per-request and guaranteed unique across all active requests
- **Task-augmented calls** — when `McpCallOptions.task` is set, augments the request with `_meta.task`, receives a `CreateTaskResult`, polls `tasks/get` until terminal, then fetches `tasks/result`. Emits `task_status` events during polling. `callTool` still resolves to `McpCallResult` — transparent to caller
- **Auto-pagination** — `listTools()` loops `listToolsPage()` until `nextCursor` is absent
- **Keepalive** — if `options.keepAlive` is set, periodic `ping`s sent at `intervalMs`; connection transitions to `error` state if no pong within `timeoutMs`
- **Timeout** per request via `options.timeout`; overridden per-call by `McpCallOptions.signal`
- **Retry** via the same `callWithRetry` utility pattern as the agent runtime
- **Notification routing** — known methods emit typed events; unknown methods emit `notification`
- **`setLogLevel` / `complete` guard** — these methods check the negotiated server capabilities before sending and throw `McpCapabilityError` if the server doesn't support them

---

## `createMcpManager` — multi-server Host (`core/manager.ts`)

In MCP spec terms this is the **Host**: it owns all client connections, aggregates their capabilities, and is the right place to enforce user-consent policies (e.g. gating sampling requests through a confirmation UI).

```ts
type McpManagerConfig = {
  servers:      Record<string, { client: McpClient }>;
  autoConnect?: boolean; // default false — caller controls lifecycle
};

type McpManager = {
  // Lifecycle
  connectAll():                           Promise<void>;
  disconnectAll():                        Promise<void>;
  connectServer(name: string):            Promise<McpServerInfo>;
  disconnectServer(name: string):         Promise<void>;
  restartServer(name: string):            Promise<McpServerInfo>;

  // Dynamic registration (for servers discovered at runtime)
  addServer(name: string, client: McpClient):  void;
  removeServer(name: string):                  Promise<void>;
  getServer(name: string):                     McpClient | undefined;
  getState(name: string):                      McpClientState | undefined;

  // Tool interface — satisfies McpRuntime from @llm-helpers/tools
  listTools(): Promise<McpTool[]>;
  callTool(params: {
    serverName: string;
    name:       string;
    arguments:  Record<string, unknown>;
    options?:   McpCallOptions;
  }): Promise<McpCallResult>;

  bus: Bus<McpManagerEventMap>;
};

function createMcpManager(config: McpManagerConfig): McpManager;
```

The manager proxies each server's bus events into its own aggregate bus and aggregates `listTools()` across all connected servers.

---

## Tasks (experimental — MCP 2025-11-25)

Tasks are a **polling-based deferred execution** mechanism introduced in 2025-11-25. They are marked as **experimental** — the protocol design may change in future spec versions.

### How it works

The protocol is **requestor-augmented**: the requestor adds `_meta.task.ttl` to any eligible request. The *receiver* then decides whether to handle the request asynchronously (returning a task ID) or synchronously (returning the normal result immediately). The requestor polls until it gets a terminal result.

- **Client as requestor, server as receiver** — the client sends `tools/call` with `_meta.task.ttl`. Server may return `CreateTaskResult` (async) or the normal `CallToolResult` (sync). Server must declare `tasks.requests.tools.call` capability to receive task-augmented tool calls
- **Server as requestor, client as receiver** — the server sends `sampling/createMessage` or `elicitation/create` with `_meta.task`. Client may respond synchronously (always valid) or return a task ID. Client declares `tasks.requests.sampling.createMessage` / `tasks.requests.elicitation.create` capability to advertise async support

In v1 the client always responds to server-side requests synchronously; the `tasks.requests.*` client capabilities are not advertised unless an explicit `options.capabilities` override is provided.

### Task states

```
working → input_required → working → ...
       ↘ completed
       ↘ failed
       ↘ cancelled
```

`input_required` means the server needs further user input — in practice this triggers a follow-up `elicitation/create` request from the server in the same task context.

### Client-side polling API (on McpClient)

```ts
// Used by callTool internally when McpCallOptions.task is set, but also available directly:
listTasks():               Promise<McpTask[]>;   // tasks/list
getTask(id: string):       Promise<McpTask>;     // tasks/get
getTaskResult(id: string): Promise<McpCallResult>; // tasks/result
cancelTask(id: string):    Promise<McpTask>;     // tasks/cancel — returns final task state
```

Cancelling a task-augmented request **must** use `tasks/cancel`, not `notifications/cancelled`. The client's `AbortSignal` handling automatically uses `tasks/cancel` for in-flight task-augmented requests.

### Notification

`notifications/tasks/status` maps to the `task_status` bus event: `{ task: McpTask }`.

---

## Transport factories

### stdio — spawns a child process, communicates over stdin/stdout

```ts
function createStdioTransport(config: {
  command: string;
  args?:   string[];
  env?:    Record<string, string>; // merged on top of parent env (not a replacement)
  cwd?:    string;
}): McpTransport;
```

Auth note: stdio servers inherit the host process environment. Per the spec, "implementations using STDIO SHOULD NOT follow the OAuth spec, and instead retrieve credentials from the environment." Pass secrets via `config.env`.

**Shutdown sequence** (spec-required for stdio): on `disconnect()` the transport:
1. Closes the child process's stdin
2. Waits up to a configurable grace period for the process to exit
3. Sends SIGTERM if still running
4. Waits for a second grace period
5. Sends SIGKILL

### stdio convenience helpers (`transports/stdio-helpers.ts`)

The MCP spec recommends clients support stdio whenever possible — it's the most widely supported transport, requires no networking, and is the default for local developer tools.

```ts
// npm package via npx — most common for JS/TS MCP servers
function createNpxStdioTransport(config: {
  package:  string;          // e.g. '@modelcontextprotocol/server-github'
  args?:    string[];
  env?:     Record<string, string>;
  cwd?:     string;
}): McpTransport;

// Python package via uvx — common for Python MCP servers
function createUvxStdioTransport(config: {
  package:  string;          // e.g. 'mcp-server-fetch'
  args?:    string[];
  env?:     Record<string, string>;
  cwd?:     string;
}): McpTransport;

// Docker container — for sandboxed or multi-language servers
function createDockerStdioTransport(config: {
  image:       string;
  args?:       string[];    // arguments passed to the container entrypoint
  env?:        Record<string, string>;
  dockerArgs?: string[];    // extra flags passed to `docker run` (e.g. volume mounts)
}): McpTransport;
```

All three delegate to `createStdioTransport`:
- `createNpxStdioTransport({ package: 'foo' })` → `createStdioTransport({ command: 'npx', args: ['-y', 'foo'] })`
- `createUvxStdioTransport({ package: 'foo' })` → `createStdioTransport({ command: 'uvx', args: ['foo'] })`
- `createDockerStdioTransport({ image: 'foo', env: { X: '1' } })` → `createStdioTransport({ command: 'docker', args: ['run', '-i', '--rm', '-e', 'X=1', 'foo'] })`

### Streamable HTTP — 2025-11-25 spec (primary HTTP transport)

```ts
function createStreamableHttpTransport(config: {
  url:        string;
  headers?:   Record<string, string>;
  auth?:      TokenProvider;
  fetchImpl?: typeof fetch;
}): McpTransport;
```

**Required HTTP behaviour (all spec-mandated):**

- **`MCP-Protocol-Version`** — included on **all** requests after initialization. If the server returns `400` for an unsupported version, the transport surfaces `McpProtocolError`
- **`Accept` header on POST** — `application/json, text/event-stream` (both MUST be listed)
- **`Accept` header on GET** — `text/event-stream`
- **Session management** — if the server returns `MCP-Session-Id` in the init response, the transport stores it and attaches it as a header on all subsequent requests. If a request returns HTTP `404`, the session has expired: the transport re-initializes (new `initialize` request without session ID) and replays the original request
- **Session teardown** — on `disconnect()`, if a session ID is held, sends HTTP `DELETE` to the endpoint with `MCP-Session-Id`
- **SSE reconnection** — servers attach event IDs to SSE messages. On reconnect, the transport sends `Last-Event-ID` so the server can replay missed messages. Servers send an SSE `retry` field (milliseconds) that the transport respects before reconnecting

### HTTP+SSE — 2024-11-05 spec (deprecated, retained for compatibility)

```ts
function createHttpTransport(config: {
  url:        string;
  headers?:   Record<string, string>;
  auth?:      TokenProvider;
  fetchImpl?: typeof fetch;
}): McpTransport;
```

This transport is **deprecated** as of MCP 2025-11-25. Retained for connecting to older servers. Applies the same `MCP-Protocol-Version` and `Accept` header requirements.

Both HTTP transports inject `Authorization: Bearer <token>` per request by calling `auth.getToken()`, and handle `401` responses by calling `auth.refreshToken()` then retrying once before surfacing `McpAuthError`.

---

## Authentication (`auth/`)

MCP's auth model differs significantly by transport:

- **stdio** — no token flow; credentials come from the process environment (env vars); spec explicitly says SHOULD NOT use OAuth
- **HTTP transports** — OAuth 2.1 with PKCE is the standard; the spec also allows simpler static tokens for servers that support API keys

### `TokenProvider` interface

```ts
type McpAuthToken = {
  accessToken: string;
  tokenType:   'Bearer';
  expiresAt?:  number; // unix ms; transport skips refresh if future
  scope?:      string;
};

type TokenProvider = {
  getToken():      Promise<McpAuthToken>;
  refreshToken?(): Promise<McpAuthToken>; // if present, transport retries once on 401
  invalidate?():   void;                  // signal that current token is known-bad
};
```

### Static token provider (`auth/static.ts`)

For API keys, personal access tokens, and any server that uses fixed credentials.

```ts
function createStaticTokenProvider(token: string): TokenProvider;
```

### OAuth 2.1 token provider (`auth/oauth.ts`)

```ts
type OAuthConfig = {
  resourceUrl: string;

  // Client identity — tried in this order per spec:
  // 1. Pre-registered clientId (already registered with this specific server)
  // 2. clientMetadataUrl (CIMD — a stable HTTPS URL hosting the client metadata doc)
  // 3. DCR (RFC 7591) if server supports it
  // 4. Prompt user (last resort)
  clientId?:          string;
  clientMetadataUrl?: string;

  redirectUri?:    string; // must be localhost or HTTPS; loopback port auto-assigned if absent
  scope?:          string;

  openAuthUrl:     (url: string) => void | Promise<void>;
  receiveAuthCode: () => Promise<{ code: string; state: string }>;

  tokenStore?: {
    load():                    Promise<McpAuthToken | null>;
    save(token: McpAuthToken): Promise<void>;
    clear():                   Promise<void>;
  };

  fetchImpl?: typeof fetch;
};

function createOAuthTokenProvider(config: OAuthConfig): TokenProvider;
```

Internal flow:

1. `getToken()` checks the token store; if valid, returns it
2. If expired but refresh token exists, calls the token endpoint with `grant_type=refresh_token`; rotates the stored token (public clients MUST rotate per OAuth 2.1 §4.3.1)
3. If no token or refresh fails, starts the full authorization code + PKCE flow:
   - Fetches Protected Resource Metadata from `resourceUrl` (RFC 9728)
   - Discovers the Authorization Server via the returned `authorization_servers` list
   - Fetches AS metadata (RFC 8414, falls back to OIDC Discovery) — **aborts if `code_challenge_methods_supported` is absent** (spec MUST; PKCE is required)
   - Resolves client identity: pre-registration → CIMD → DCR (RFC 7591)
   - Generates `code_verifier` / `code_challenge` (PKCE S256, REQUIRED)
   - Builds the authorization URL including `resource` (RFC 8707) and `state`
   - Calls `openAuthUrl` then awaits `receiveAuthCode`
   - Exchanges code + verifier at the token endpoint, saves to store

**Step-up authorization**: if a `403` with `insufficient_scope` is received, the transport calls `invalidate()` and the next `getToken()` re-initiates the flow with the new scope from the `WWW-Authenticate` header. A retry limit prevents infinite loops.

### Discovery helpers (`auth/discovery.ts`)

```ts
function discoverProtectedResource(resourceUrl: string, fetchImpl?: typeof fetch): Promise<ProtectedResourceMetadata>;
function discoverAuthServer(issuerUrl: string, fetchImpl?: typeof fetch): Promise<AuthServerMetadata>;
function discoverAuth(resourceUrl: string, fetchImpl?: typeof fetch): Promise<AuthServerMetadata>;
```

---

## Error hierarchy (`core/errors.ts`)

```ts
McpError                         // base; carries optional serverName
  McpConnectionError             // transport failed to connect
  McpProtocolError               // malformed JSON-RPC / unexpected message shape / protocol version mismatch
  McpHandshakeError              // initialize rejected or capability mismatch
  McpCapabilityError             // method called when server did not declare the required capability
  McpToolError                   // tool call returned isError: true
  McpTimeoutError                // request exceeded timeout or ping timed out
  McpServerNotFoundError         // manager couldn't find a server by name
  McpSessionExpiredError         // HTTP 404 with MCP-Session-Id — triggers re-initialization
  McpAuthError                   // 401/403 after token refresh, or discovery failure
    McpAuthDiscoveryError        // well-known endpoint unreachable or malformed
    McpAuthFlowError             // OAuth flow failed (user cancelled, code exchange error, etc.)
    McpUrlElicitationRequiredError // server requires URL-mode elicitation but client didn't declare url capability (code -32042)
```

---

## Public surface (`index.ts`)

```ts
// Client + manager
export { createMcpClient }  from './core/client.js';
export { createMcpManager } from './core/manager.js';

// Transports
export { createStdioTransport }                                           from './transports/stdio.js';
export { createNpxStdioTransport, createUvxStdioTransport,
         createDockerStdioTransport }                                     from './transports/stdio-helpers.js';
export { createStreamableHttpTransport }                                  from './transports/streamable.js';
export { createHttpTransport }                                            from './transports/http.js'; // deprecated

// Auth
export { createStaticTokenProvider }                                      from './auth/static.js';
export { createOAuthTokenProvider }                                       from './auth/oauth.js';
export { discoverAuth, discoverAuthServer, discoverProtectedResource }    from './auth/discovery.js';

// Errors
export {
  McpError,
  McpConnectionError,
  McpProtocolError,
  McpHandshakeError,
  McpCapabilityError,
  McpToolError,
  McpTimeoutError,
  McpServerNotFoundError,
  McpSessionExpiredError,
  McpAuthError,
  McpAuthDiscoveryError,
  McpAuthFlowError,
  McpUrlElicitationRequiredError,
} from './core/errors.js';

// Types
export type {
  McpTransport,
  McpClient,
  McpManager,
  McpManagerConfig,
  McpClientOptions,
  McpClientHandlers,
  McpClientHooks,
  McpClientCapabilities,
  McpCallOptions,
  McpClientState,
  McpServerInfo,
  McpServerCapabilities,
  McpTool,
  McpToolAnnotations,
  McpContent,
  McpCallResult,
  McpRoot,
  SamplingRequest,
  SamplingResult,
  ElicitationRequest,
  ElicitationFormRequest,
  ElicitationUrlRequest,
  ElicitationResult,
  McpTask,
  McpTaskStatus,
  McpLogLevel,
  McpCompletionRef,
  McpCompletionResult,
  McpClientEventMap,
  McpManagerEventMap,
  McpAuthToken,
  TokenProvider,
  OAuthConfig,
} from './types.js';
```

---

## Composition with the existing stack

```ts
// stdio server via npx — most common setup for JS/TS MCP servers
const localClient = createMcpClient(
  createNpxStdioTransport({ package: '@acme/mcp-server', env: { API_KEY: '...' } }),
  {
    timeout:   10_000,
    keepAlive: { intervalMs: 30_000, timeoutMs: 5_000 },
  },
);

// Remote server — API key
const remoteClient = createMcpClient(
  createStreamableHttpTransport({
    url:  'https://api.example.com/mcp',
    auth: createStaticTokenProvider(process.env.MCP_TOKEN!),
  }),
);

// Remote server — full OAuth 2.1
const oauthClient = createMcpClient(
  createStreamableHttpTransport({
    url:  'https://secure.example.com/mcp',
    auth: createOAuthTokenProvider({
      resourceUrl:  'https://secure.example.com/mcp',
      clientId:     'my-registered-client-id', // pre-registration takes priority
      scope:        'tools:read tools:write',
      openAuthUrl:  (url) => open(url),
      receiveAuthCode: startLocalCallbackServer,
    }),
  }),
  {
    handlers: {
      onSampling:    (req) => myLlm.complete(req),
      onElicitation: (req) => promptUser(req),
      onRootsList:   () => [{ uri: 'file:///home/user/project', name: 'My Project' }],
    },
  },
);

// Aggregate into a manager (= MCP Host)
const manager = createMcpManager({
  servers: {
    local:  { client: localClient },
    remote: { client: remoteClient },
    secure: { client: oauthClient },
  },
});

await manager.connectAll();

// Re-aggregate tools whenever a server's list changes
manager.bus.on('server_tools_changed', ({ name }) => {
  console.log(`${name} tool list changed — refreshing`);
});

// Tool call with per-call cancellation and progress
const ac = new AbortController();
const result = await manager.callTool({
  serverName: 'remote',
  name:       'generate_report',
  arguments:  { query: '...' },
  options: {
    signal:     ac.signal,
    onProgress: (p, total, msg) => console.log(`${p}/${total}: ${msg}`),
  },
});

// Drops directly into @llm-helpers/tools — no adapter needed
const toolSystem = createToolSystem({
  providers: [
    createMcpProvider(manager),
    createFunctionProvider('local', [...]),
  ],
});
```

---

## What is deliberately left out of v1 (keeping it unopinionated)

- **No MCP SDK dependency** — users who prefer `@modelcontextprotocol/sdk` can wrap its transport as a `McpTransport`
- **No auto-reconnect** — `restart()` is exposed; reconnect policy is the caller's decision
- **No tool caching** — `listTools()` always goes to the server; callers memoize if needed; listen to `server_tools_changed` to invalidate
- **No browser / callback server** — `OAuthConfig.openAuthUrl` and `receiveAuthCode` are caller-supplied
- **No HTTP transport auto-detection** — the spec defines a POST-then-GET detection algorithm for distinguishing 2024 vs 2025 transports; this package treats them as two explicit choices (`createHttpTransport` vs `createStreamableHttpTransport`)
- **Resources, Prompts, context aggregation** — deferred to v2; see section below
- **Task-augmented sampling/elicitation responses** — in v1, all server-to-client requests are answered synchronously; the `tasks.requests.*` client capabilities are not advertised

---

## V2: Resources, Prompts, and Context Aggregation

Not implemented in v1, but the structure is designed to accommodate these without breaking changes.

### Additional types (`types.ts`)

```ts
type McpResource = {
  serverName:   string;
  uri:          string;
  name:         string;
  title?:       string;
  description?: string;
  mimeType?:    string;
  size?:        number; // bytes
};

type McpResourceTemplate = {
  serverName:   string;
  uriTemplate:  string; // RFC 6570 URI template
  name:         string;
  title?:       string;
  description?: string;
  mimeType?:    string;
};

type McpResourceContent = {
  uri:       string;
  mimeType?: string;
  text?:     string;  // text resources
  blob?:     string;  // base64-encoded binary resources
};

type McpPromptArgument = {
  name:         string;
  description?: string;
  required?:    boolean;
};

type McpPrompt = {
  serverName:   string;
  name:         string;
  title?:       string;
  description?: string;
  arguments?:   McpPromptArgument[];
};

type McpPromptMessage = {
  role:    'user' | 'assistant';
  content: McpContent;
};

type McpGetPromptResult = {
  description?: string;
  messages:     McpPromptMessage[];
};
```

### Additional `McpClient` methods

```ts
// Resources
listResources(cursor?: string):                                        Promise<{ resources: McpResource[]; nextCursor?: string }>;
listResourcesAll():                                                    Promise<McpResource[]>;
listResourceTemplates(cursor?: string):                                Promise<{ templates: McpResourceTemplate[]; nextCursor?: string }>;
readResource(uri: string):                                             Promise<McpResourceContent[]>;
subscribeResource(uri: string):                                        Promise<void>;   // requires server capabilities.resources.subscribe
unsubscribeResource(uri: string):                                      Promise<void>;

// Prompts
listPrompts(cursor?: string):                                          Promise<{ prompts: McpPrompt[]; nextCursor?: string }>;
listPromptsAll():                                                      Promise<McpPrompt[]>;
getPrompt(name: string, args?: Record<string, string>):               Promise<McpGetPromptResult>;
```

The existing `resources_changed`, `resource_updated`, and `prompts_changed` bus events (already in the v1 event map) wire up to these directly — no schema changes needed.

### Additional `McpManager` methods

```ts
// Resources — aggregates across all connected servers
listResources():                                               Promise<McpResource[]>;
readResource(serverName: string, uri: string):                 Promise<McpResourceContent[]>;

// Prompts — aggregates across all connected servers
listPrompts():                                                 Promise<McpPrompt[]>;
getPrompt(serverName: string, name: string, args?: Record<string, string>): Promise<McpGetPromptResult>;
```

### Context aggregation design note

`listTools()` already uses the `serverName` field on `McpTool` for routing — resources and prompts follow the same pattern. The manager keeps a routing table of `uri → serverName` built from `listResources()` results, which lets `readResource` receive a bare URI without the caller needing to track which server owns it. Name collisions across servers (two servers expose a prompt called `summarise`) are surfaced as `McpProtocolError` at aggregation time rather than silently returning the wrong result.

`listResourceTemplates` is a distinct operation from `listResources` (per the spec) and must be aggregated separately.

The `McpManagerEventMap` gains two more aggregate events in v2:

```ts
server_resources_changed: { name: string };
server_prompts_changed:   { name: string };
```
