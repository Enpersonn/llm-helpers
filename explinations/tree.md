
VS Code (Host)
│
├── Copilot Chat UI
├── Agent orchestration
├── Permission system
├── Conversation state
├── Workspace access
│
└── MCP Client subsystem
     │
     ├── stdio transport
     ├── HTTP transport
     ├── session handling
     ├── tool registry
     └── JSON-RPC handling
            │
            ▼
      Figma MCP Server


---

VS Code Host
    ↓
MCP Client subsystem
    ↓
spawn process:
npx -y @microsoft/mcp-server-playwright
    ↓
npx checks local npm cache
    ↓
if missing:
download package from npm registry
    ↓
extract package into npm cache
    ↓
execute package entrypoint
    ↓
MCP server process starts
    ↓
stdio connection established
    ↓
MCP initialize handshake starts