import dotenv from 'dotenv';

dotenv.config();

import { runAgentDemo } from './agent-demo.js';

// import { runLlmRouterDemos } from './llm-router.js';

// console.log('=== LLM Request Router ===');
// await runLlmRouterDemos();

console.log('\n=== Agent Runtime Handler ===');
await runAgentDemo();
