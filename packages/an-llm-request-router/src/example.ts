import { LLM } from './llm.js';

const llm = new LLM({
	defaultProvider: 'ollama',

	providers: {
		ollama: {
			model: 'llama3.1',
		},
	},
});

// openai: createOpenAIAdapter({
//   apiKey: process.env.OPENAI_API_KEY!,
//   model: "gpt-4.1-mini",
// }),
// anthropic: createAnthropicAdapter({
//   apiKey: process.env.ANTHROPIC_API_KEY!,
//   model: "claude-3-5-sonnet-latest",
// }),
// gemini: createGeminiAdapter({
//   apiKey: process.env.GOOGLE_API_KEY!,
//   model: "gemini-1.5-flash",
// }),

const result = await llm.chat({
	messages: [
		{
			role: 'user',
			content: 'Explain adapters in TypeScript.',
		},
	],
});

console.log(result.text);

const resultAnthropic = await llm.chat({
	// This is suppoosed to give an error if types are set up correctly
	// @ts-expect-error Its for testing provider types
	provider: 'anthropic',
	messages: [
		{
			role: 'user',
			content: 'Review this architecture.',
		},
	],
});
