import dotenv from 'dotenv';

dotenv.config({ path: 'packages/an-llm-request-router/.env' });

import { createLLM } from './llm.js';

const llm = createLLM({
	defaultProvider: 'ollama',

	providers: {
		ollama: {
			model: 'gemma4',
		},
		gemini: {
			apiKey: process.env.GEMINI_API_KEY!,
			model: 'gemini-2.5-flash',
		},
	},
});

const stream = llm.stream({
	messages: [
		{
			role: 'user',
			content: 'Roses are red',
		},
	],
});

for await (const chunk of stream) {
	process.stdout.write(chunk.text);

	if (chunk.done) {
		process.stdout.write('\n');
	}
}

const gemini = llm.use('gemini');

const testGeminiRes = await gemini.chat({
	messages: [
		{
			role: 'user',
			content: 'explain sleeping beauty in one paragraph',
		},
	],
});

console.log(testGeminiRes.text);
