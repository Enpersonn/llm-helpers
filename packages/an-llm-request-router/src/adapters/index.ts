import { geminiFactory } from './gemini.js';
import { ollamaFactory } from './ollama.js';
import { openaiFactory } from './openAi.js';

export const internalAdapters = {
	ollama: ollamaFactory,
	gemini: geminiFactory,
	openai: openaiFactory,
} as const;

export type InternalAdapters = typeof internalAdapters;
