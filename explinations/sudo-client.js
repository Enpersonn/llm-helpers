class McpClient {
	constructor(serverConfig) {
		this.serverConfig = serverConfig;
		this.serverCapabilities = {};
		this.tools = {};
		this.connection = null;
	}

	startServerOrConnect() {
		if (this.serverConfig.type === 'stdio') {
			// Example:
			// npx -y @microsoft/mcp-server-playwright
			this.connection = spawnProcess(this.serverConfig.command, this.serverConfig.args);
		}

		if (this.serverConfig.type === 'http') {
			this.connection = connectHttp(this.serverConfig.url);
		}
	}

	initializeProtocolLifecycle() {
		const clientCapabilities = {
			roots: true,
			sampling: false,
			elicitation: false,
		};

		const response = this.connection.send({
			method: 'initialize',
			params: {
				protocolVersion: '2025-xx-xx',
				capabilities: clientCapabilities,
				clientInfo: {
					name: 'VS Code',
					version: '...',
				},
			},
		});

		this.serverCapabilities = response.capabilities;

		this.connection.send({
			method: 'notifications/initialized',
		});
	}

	discoverTools() {
		const response = this.connection.send({
			method: 'tools/list',
		});

		this.tools = response.tools;
	}

	async callTool(name, args) {
		return await this.connection.send({
			method: 'tools/call',
			params: {
				name,
				arguments: args,
			},
		});
	}

	shutdown() {
		this.connection.close();
	}
}
