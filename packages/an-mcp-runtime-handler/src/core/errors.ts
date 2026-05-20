export class McpError extends Error {
	constructor(
		message: string,
		public readonly serverName?: string,
	) {
		super(message);
		this.name = 'McpError';
	}
}

export class McpConnectionError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpConnectionError';
	}
}

export class McpProtocolError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpProtocolError';
	}
}

export class McpHandshakeError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpHandshakeError';
	}
}

export class McpCapabilityError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpCapabilityError';
	}
}

export class McpToolError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpToolError';
	}
}

export class McpTimeoutError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpTimeoutError';
	}
}

export class McpServerNotFoundError extends McpError {
	constructor(name: string) {
		super(`MCP server not found: ${name}`);
		this.name = 'McpServerNotFoundError';
	}
}

export class McpSessionExpiredError extends McpError {
	constructor(serverName?: string) {
		super('MCP session expired (HTTP 404)', serverName);
		this.name = 'McpSessionExpiredError';
	}
}

export class McpAuthError extends McpError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpAuthError';
	}
}

export class McpAuthDiscoveryError extends McpAuthError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpAuthDiscoveryError';
	}
}

export class McpAuthFlowError extends McpAuthError {
	constructor(message: string, serverName?: string) {
		super(message, serverName);
		this.name = 'McpAuthFlowError';
	}
}

export class McpUrlElicitationRequiredError extends McpAuthError {
	constructor(serverName?: string) {
		super('Server requires URL-mode elicitation but client did not declare url capability', serverName);
		this.name = 'McpUrlElicitationRequiredError';
	}
}
