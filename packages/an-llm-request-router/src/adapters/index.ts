import { ollamaFactory } from './ollama.js';

export const internalAdapters = {
	ollama: ollamaFactory,
	// openai: createOpenAIAdapter,
	// anthropic: createAnthropicAdapter,
	// gemini: createGeminiAdapter,
} as const;

export type InternalAdapters = typeof internalAdapters;
