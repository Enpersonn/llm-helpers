import { geminiFactory } from './gemini.js';
import { ollamaFactory } from './ollama.js';

export const internalAdapters = {
	ollama: ollamaFactory,
	gemini: geminiFactory,
	// openai: createOpenAIAdapter,
	// anthropic: createAnthropicAdapter,
} as const;

export type InternalAdapters = typeof internalAdapters;
