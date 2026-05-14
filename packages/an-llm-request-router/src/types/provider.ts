import { z } from 'zod';

export const InternalProviderNames = ['ollama', 'openai', 'anthropic', 'gemini'] as const;

export type InternalProviderName = (typeof InternalProviderNames)[number];

export const InternalProviderNameSchema = z.enum(InternalProviderNames);
