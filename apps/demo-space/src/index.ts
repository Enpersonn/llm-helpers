import dotenv from 'dotenv';

dotenv.config();

import { runLlmRouterDemos } from './llm-router.js';

console.log('=== LLM Request Router ===');
await runLlmRouterDemos();
