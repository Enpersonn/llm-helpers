function initializeMCPHost(user) {
	const host = new HostApplication(user);

	host.loadMcpServerConfigs();

	for (const serverConfig of host.enabledMcpServers) {
		const client = new McpClient(serverConfig);

		client.startServerOrConnect();
		client.initializeProtocolLifecycle();
		client.discoverCapabilities();
		client.discoverTools();

		host.registerMcpClient(client);
	}

	while (host.running) {
		const event = host.waitForUserEvent();

		if (event.type === 'chat-message') {
			host.handleChatMessage(event.message);
		}
	}

	host.shutdownAllMcpClients();
}
