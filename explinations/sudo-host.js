class HostApplication {
	constructor(user) {
		this.user = user;
		this.mcpClients = [];
		this.chatHistory = [];
	}

	registerMcpClient(client) {
		this.mcpClients.push(client);
	}

	getAllAvailableTools() {
		return this.mcpClients.flatMap((client) => {
			return Object.values(client.tools).map((tool) => ({
				...tool,
				client,
			}));
		});
	}

	async handleChatMessage(userMessage) {
		const availableTools = this.getAllAvailableTools();

		const agentContext = {
			messages: [...this.chatHistory, userMessage],
			tools: availableTools,
		};

		while (true) {
			const llmResponse = await callLLM(agentContext);

			if (llmResponse.type === 'tool_call') {
				const toolCall = llmResponse.toolCall;

				const allowed = await this.askPermissionIfNeeded(toolCall);

				if (!allowed) {
					agentContext.messages.push({
						role: 'tool',
						content: 'User denied tool call.',
					});
					continue;
				}

				const toolResult = await toolCall.client.callTool(toolCall.name, toolCall.arguments);

				agentContext.messages.push({
					role: 'tool',
					toolName: toolCall.name,
					content: toolResult,
				});

				continue;
			}

			if (llmResponse.type === 'final_answer') {
				this.chatHistory.push(userMessage);
				this.chatHistory.push(llmResponse.message);
				return llmResponse.message;
			}
		}
	}
}
