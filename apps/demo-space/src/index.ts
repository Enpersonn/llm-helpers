import dotenv from 'dotenv';

dotenv.config();

// import { runAgentDemo } from './agent-demo.js';
// import { runMcpDemo } from './mcp-demo.js';
import { runMcpManagerDemo } from './mcp-manager-demo.js';

// import { runLlmRouterDemos } from './llm-router.js';

// console.log('=== LLM Request Router ===');
// await runLlmRouterDemos();

// console.log('\n=== Agent Runtime Handler ===');
// await runAgentDemo();

// console.log('\n=== MCP Demo ===');
// await runMcpDemo();

console.log('\n=== MCP Manager Demo ===');
await runMcpManagerDemo();
