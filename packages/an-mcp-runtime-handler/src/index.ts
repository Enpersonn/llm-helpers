// Client + manager

export { discoverAuth, discoverAuthServer, discoverProtectedResource } from './auth/discovery.js';
export { createOAuthTokenProvider } from './auth/oauth.js';
// Auth
export { createStaticTokenProvider } from './auth/static.js';
export { createMcpClient } from './core/client.js';
// Errors
export {
	McpAuthDiscoveryError,
	McpAuthError,
	McpAuthFlowError,
	McpCapabilityError,
	McpConnectionError,
	McpError,
	McpHandshakeError,
	McpProtocolError,
	McpServerNotFoundError,
	McpSessionExpiredError,
	McpTimeoutError,
	McpToolError,
	McpUrlElicitationRequiredError,
} from './core/errors.js';
export { createMcpManager } from './core/manager.js';
export { createHttpTransport } from './transports/http.js';
// Transports
export { createStdioTransport } from './transports/stdio.js';
export {
	createDockerStdioTransport,
	createNpxStdioTransport,
	createUvxStdioTransport,
} from './transports/stdio-helpers.js';
export { createStreamableHttpTransport } from './transports/streamable.js';

// Types
export type {
	ElicitationFormRequest,
	ElicitationRequest,
	ElicitationResult,
	ElicitationUrlRequest,
	InitializeParams,
	JsonRpcMessage,
	McpAuthToken,
	McpCallOptions,
	McpCallResult,
	McpClient,
	McpClientCapabilities,
	McpClientEventMap,
	McpClientHandlers,
	McpClientHooks,
	McpClientOptions,
	McpClientState,
	McpCompletionRef,
	McpCompletionResult,
	McpContent,
	McpLogLevel,
	McpManager,
	McpManagerConfig,
	McpManagerEventMap,
	McpRoot,
	McpServerCapabilities,
	McpServerInfo,
	McpTask,
	McpTaskStatus,
	McpTool,
	McpToolAnnotations,
	McpTransport,
	OAuthConfig,
	SamplingRequest,
	SamplingResult,
	TokenProvider,
} from './types.js';
