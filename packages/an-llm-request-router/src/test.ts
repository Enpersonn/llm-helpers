import { LLM } from './llm.js';

const llm = new LLM({
	defaultProvider: 'ollama',

	providers: {
		ollama: {
			model: 'gemma4',
		},
	},
});

const result = await llm.chat({
	messages: [
		{
			role: 'user',
			content: 'Explain adapters in TypeScript.',
		},
	],
});

console.log(result.text);
