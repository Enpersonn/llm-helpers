import { z } from "zod";
import { modelAdapterRegistry } from "./llm.js";

export const LLMMessageSchema = z.object({
	content: z.string(),
	role: z.enum(["system", "user", "assistant"]),
});

export type LLMMessage = z.infer<typeof LLMMessageSchema>;

export const LLMStreamChunkSchema = z.object({
	created_at: z.string(),
	done: z.boolean(),
	done_reason: z.string().optional(),
	eval_count: z.number().optional(),
	message: z.object({
		content: z.string(),
		role: z.literal("assistant"),
	}),
	model: z.string(),
	prompt_eval_count: z.number().optional(),
	total_duration: z.number().optional(),
});
export type LLMStreamChunk = z.infer<typeof LLMStreamChunkSchema>;

export type registerTypes = keyof typeof modelAdapterRegistry;

export type LLMRequest = {
	provider?: registerTypes;
	model?: string;
	messages: LLMMessage[];
	temperature?: number;
	maxTokens?: number;
	stream?: boolean;
	json?: boolean;
	signal?: AbortSignal;
};

export const LLMConfigSchema = z.object({
	defaultProvider: z.enum(
		Object.keys(modelAdapterRegistry) as [registerTypes, ...registerTypes[]],
	),
	model: z.string(),
	temperature: z.number().default(0.85),
	maxTokens: z.number().optional(),
	top_k: z.number().default(40),
	top_p: z.number().default(0.9),
	repeat_penalty: z.number().default(1.1),
});
