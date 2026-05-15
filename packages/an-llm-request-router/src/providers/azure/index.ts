import { adapterFactory } from '../../core/factory.js';
import { makeOpenAICompatMethods, type OpenAICompatAdapter } from '../util/openai-compat.js';

type AzureConfig = {
	apiKey: string;
	endpoint: string;
	deployment: string;
	apiVersion: string;
};

export const azure = adapterFactory('azure', (config: AzureConfig): OpenAICompatAdapter => {
	let client: import('openai').default | undefined;

	async function getClient() {
		if (client) return client;
		const { AzureOpenAI } = await import('openai');
		client = new AzureOpenAI({
			apiKey: config.apiKey,
			endpoint: config.endpoint,
			apiVersion: config.apiVersion,
			deployment: config.deployment,
		});
		return client;
	}

	return {
		capabilities: { nativeThinking: false, streaming: true, vision: false },
		...makeOpenAICompatMethods(getClient, 'azure', () => config.deployment),
	};
});
