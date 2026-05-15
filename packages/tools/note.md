A collection of pre made tools for the agent runtime handler


The Tool System sits between the Agent Runtime and every possible tool backend.

It is the abstraction layer that prevents your agent from caring whether a tool came from MCP, a local function, a shell command, a database, a browser automation tool, or an internal API.

Architecturally:

```text
User
  ↓
Agent Runtime
  ↓
Tool System
  ↓
Tool Providers
  ↓
Actual tools
```

More detailed:

```text
Agent Runtime
  - decides it needs a tool
  - receives tool calls from the LLM
  - asks Tool System to execute them

Tool System
  - knows which tools exist
  - maps tool names to providers
  - validates arguments
  - checks permissions
  - applies timeout
  - executes tool
  - normalizes the result

Tool Providers
  - MCP provider
  - file provider
  - shell provider
  - git provider
  - browser provider
  - internal app provider
```

So the agent runtime does not do this:

```ts
if (tool.name === "mcp_figma_get_design_context") {
  callMcp(...)
}

if (tool.name === "read_file") {
  fs.readFile(...)
}

if (tool.name === "run_command") {
  child_process.spawn(...)
}
```

Instead, it does this:

```ts
const result = await toolSystem.execute(toolCall, context)
```

That is the whole point.

A clean architecture could look like this:

```ts
type ToolDefinition = {
  name: string
  description: string
  inputSchema: unknown
}

type ToolCall = {
  id: string
  name: string
  arguments: Record<string, unknown>
}

type ToolResult = {
  toolCallId: string
  ok: boolean
  content: unknown
  metadata?: Record<string, unknown>
  error?: {
    message: string
    code?: string
  }
}
```

Then a tool provider is anything that can expose and execute tools:

```ts
type ToolProvider = {
  id: string

  listTools(): Promise<ToolDefinition[]>

  callTool(
    call: ToolCall,
    context: ToolExecutionContext
  ): Promise<ToolResult>
}
```

Example providers:

```ts
const toolSystem = createToolSystem({
  providers: [
    fileTools({ root: process.cwd() }),
    shellTools({ root: process.cwd() }),
    gitTools({ root: process.cwd() }),
    mcpTools({ servers: [...] }),
    internalTools({ db })
  ]
})
```

Then the agent uses only the tool system:

```ts
const agent = createAgent({
  model,
  tools: toolSystem
})
```

During startup:

```text
Agent starts
  ↓
Tool System asks each provider: listTools()
  ↓
File provider returns read_file, write_file, edit_file
  ↓
Shell provider returns run_command
  ↓
Git provider returns git_status, git_diff
  ↓
MCP provider returns figma_get_context, playwright_navigate, etc.
  ↓
Tool System builds one tool registry
  ↓
Agent passes available tools to the LLM
```

At runtime:

```text
User: "Run the tests and fix the failing one"
  ↓
Agent sends prompt + tools to LLM
  ↓
LLM returns tool call: run_command({ command: "npm test" })
  ↓
Agent asks Tool System to execute
  ↓
Tool System finds ShellProvider
  ↓
Tool System checks permission
  ↓
Tool System starts timeout
  ↓
ShellProvider runs command
  ↓
Tool System normalizes stdout/stderr/exitCode
  ↓
Agent sends result back to LLM
  ↓
LLM decides next step
```

The Tool System owns seven important jobs.

Tool discovery means collecting all tools from all providers.

```ts
class ToolSystem {
  async listTools() {
    const all = []

    for (const provider of this.providers) {
      const tools = await provider.listTools()

      for (const tool of tools) {
        all.push({
          ...tool,
          providerId: provider.id
        })
      }
    }

    return all
  }
}
```

Tool execution means finding the correct provider and calling it.

```ts
async execute(call: ToolCall, context: ToolExecutionContext) {
  const provider = this.registry.getProviderForTool(call.name)

  if (!provider) {
    return {
      toolCallId: call.id,
      ok: false,
      content: null,
      error: { message: `Unknown tool: ${call.name}` }
    }
  }

  return await provider.callTool(call, context)
}
```

Tool routing means mapping tool names to the correct provider.

This gets important because multiple providers may expose tools with the same name.

For example:

```text
MCP GitHub server exposes: search
Internal docs provider exposes: search
File provider exposes: search
```

So the Tool System should namespace tools.

Better:

```text
file.read
file.write
shell.run
git.diff
mcp.figma.get_design_context
mcp.playwright.browser_navigate
internal.search_docs
```

Internally:

```ts
toolRegistry = {
  "file.read": FileProvider,
  "shell.run": ShellProvider,
  "mcp.figma.get_design_context": FigmaMcpProvider
}
```

Tool permissions means the Tool System checks policy before execution.

The Agent should not execute tools directly. The Tool System should intercept.

```ts
const decision = await permissions.check({
  tool: call.name,
  arguments: call.arguments,
  context
})

if (decision.type === "deny") {
  return deniedResult(call)
}

if (decision.type === "ask-user") {
  const approved = await context.requestApproval(decision.message)

  if (!approved) {
    return deniedResult(call)
  }
}
```

Policy examples:

```ts
const permissions = createPermissions({
  rules: [
    allow("file.read"),
    ask("file.write"),
    ask("shell.run"),
    deny("shell.run", {
      when: args => args.command.includes("rm -rf")
    }),
    allow("git.diff"),
    ask("mcp.*")
  ]
})
```

Tool timeouts prevent a tool from hanging forever.

```ts
const result = await withTimeout(
  provider.callTool(call, context),
  30_000
)
```

Some tools should have different defaults:

```text
file.read: 5 seconds
git.diff: 10 seconds
shell.run: 60 seconds
npm test: 5 minutes
browser navigation: 30 seconds
MCP call: 30 seconds
```

Tool result normalization means every tool returns the same shape.

Bad design:

```ts
read_file returns string
run_command returns { stdout, stderr }
mcp returns array of content blocks
git.diff returns Buffer
```

Good design:

```ts
type ToolResult = {
  ok: boolean
  content: ToolContent[]
  metadata?: Record<string, unknown>
}
```

For example:

```ts
type ToolContent =
  | { type: "text"; text: string }
  | { type: "json"; value: unknown }
  | { type: "image"; data: string; mimeType: string }
  | { type: "file"; path: string; mimeType?: string }
```

Then a shell result becomes:

```ts
{
  ok: true,
  content: [
    {
      type: "text",
      text: "Tests failed: expected 2, received 3"
    }
  ],
  metadata: {
    exitCode: 1,
    stdoutBytes: 1200,
    stderrBytes: 400
  }
}
```

An MCP result becomes:

```ts
{
  ok: true,
  content: [
    {
      type: "json",
      value: {
        frameName: "Pricing Card",
        layout: "vertical",
        spacing: 16
      }
    }
  ],
  metadata: {
    provider: "mcp",
    server: "figma"
  }
}
```

Then the Agent Runtime can treat both the same.

A minimal class layout:

```ts
class AgentRuntime {
  constructor(
    private model: ModelAdapter,
    private tools: ToolSystem
  ) {}

  async run(userMessage: string) {
    const availableTools = await this.tools.listTools()

    let messages = [
      { role: "user", content: userMessage }
    ]

    while (true) {
      const response = await this.model.generate({
        messages,
        tools: availableTools
      })

      if (response.type === "tool_calls") {
        for (const call of response.toolCalls) {
          const result = await this.tools.execute(call, {
            sessionId: "...",
            cwd: process.cwd()
          })

          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: result
          })
        }

        continue
      }

      return response.content
    }
  }
}
```

The Tool System is not MCP-specific.

MCP is just one provider:

```ts
class McpToolProvider implements ToolProvider {
  constructor(private mcpRuntime: McpRuntime) {}

  async listTools() {
    const tools = await this.mcpRuntime.listTools()

    return tools.map(tool => ({
      name: `mcp.${tool.serverName}.${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema
    }))
  }

  async callTool(call: ToolCall) {
    const { serverName, toolName } = parseMcpToolName(call.name)

    const result = await this.mcpRuntime.callTool({
      serverName,
      name: toolName,
      arguments: call.arguments
    })

    return normalizeMcpResult(result)
  }
}
```

A file provider:

```ts
class FileToolProvider implements ToolProvider {
  id = "file"

  async listTools() {
    return [
      {
        name: "file.read",
        description: "Read a file from the workspace",
        inputSchema: {
          type: "object",
          properties: {
            path: { type: "string" }
          },
          required: ["path"]
        }
      }
    ]
  }

  async callTool(call: ToolCall, context: ToolExecutionContext) {
    if (call.name === "file.read") {
      const text = await fs.promises.readFile(
        resolveSafePath(context.cwd, call.arguments.path),
        "utf8"
      )

      return {
        toolCallId: call.id,
        ok: true,
        content: [{ type: "text", text }]
      }
    }

    throw new Error(`Unknown file tool: ${call.name}`)
  }
}
```

Architecturally, the package boundaries would be:

```text
@scope/agent
  uses ToolSystem interface
  does not know MCP exists

@scope/tools
  provides ToolSystem implementation
  provides file/shell/git providers

@scope/mcp-runtime
  provides MCP client lifecycle

@scope/mcp-tools
  adapts MCP runtime into ToolProvider

@scope/llm
  provides ModelAdapter implementations
```

Or keep it simpler:

```text
@scope/agent
  includes ToolSystem core types

@scope/mcp-runtime
  optionally implements ToolProvider

@scope/tools-node
  file/shell/git tool providers

@scope/llm
  model adapters
```

The cleanest principle:

```text
Agent Runtime decides what to do next.
Tool System decides how tools are found, checked, routed, and executed.
Tool Providers actually do the work.
```

That separation is what lets you support MCP, internal tools, local shell, browser automation, and custom app actions without rewriting the agent.
