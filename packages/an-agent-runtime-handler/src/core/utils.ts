import { buildCombinedSignal, callWithRetry } from '@llm-helpers/core';
import type { LLMUsage } from '@llm-helpers/types';

export { buildCombinedSignal, callWithRetry };

export const accumulateUsage = (total: LLMUsage, delta?: LLMUsage): void => {
	if (!delta) return;
	total.inputTokens = (total.inputTokens ?? 0) + (delta.inputTokens ?? 0);
	total.outputTokens = (total.outputTokens ?? 0) + (delta.outputTokens ?? 0);
	total.totalTokens = (total.totalTokens ?? 0) + (delta.totalTokens ?? 0);
};
