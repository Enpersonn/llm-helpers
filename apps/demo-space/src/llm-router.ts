import { createLLM, isChatProvider, isStreamingProvider, ollamaFactory } from 'an-llm-request-router';

export async function runLlmRouterDemos() {
	const geminiKey = process.env.GEMINI_API_KEY;
	if (!geminiKey) throw new Error('GEMINI_API_KEY not set — copy .env.example to .env and fill it in');

	const llm = createLLM(
		{
			defaultProvider: 'ollama',
			providers: {
				ollama: { model: 'gemma4' },
				gemini: { apiKey: geminiKey, model: 'gemini-2.5-flash' },
			},
		},
		{
			middleware: (fn, { provider, method }) =>
				(...args) => {
					console.log(`  [${provider}.${method}] called`);
					return fn(...args);
				},
		},
	);

	console.log('\n[ollama stream]');
	const ollama = llm.use('ollama');
	for await (const chunk of ollama.stream({ messages: [{ role: 'user', content: 'Roses are red' }] })) {
		process.stdout.write(chunk.text);
		if (chunk.done) process.stdout.write('\n');
	}

	console.log('\n[gemini chat via default()]');
	const llmGemini = createLLM({
		defaultProvider: 'gemini',
		providers: { gemini: { apiKey: geminiKey, model: 'gemini-2.5-flash' } },
	});
	const geminiRes = await llmGemini.default().chat({
		messages: [{ role: 'user', content: 'Explain sleeping beauty in one paragraph.' }],
	});
	console.log(geminiRes.text);

	console.log('\n[type guards]');
	console.log('ollama isChatProvider:', isChatProvider(ollama));
	console.log('ollama isStreamingProvider:', isStreamingProvider(ollama));

	console.log('\n[.extend()]');
	const countingOllama = ollamaFactory.extend((base) => ({
		chat: async (req) => {
			console.log('  chars in prompt:', req.messages.map((m) => m.content).join('').length);
			return base.chat(req);
		},
	}));
	const llmExtended = createLLM(
		{ defaultProvider: 'ollama', providers: { ollama: { model: 'gemma4' } } },
		{ adapters: { ollama: countingOllama } },
	);
	const extendedRes = await llmExtended.use('ollama').chat({ messages: [{ role: 'user', content: 'Hi' }] });
	console.log(extendedRes.text.slice(0, 80));
}
