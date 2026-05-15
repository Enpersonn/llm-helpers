To compete with Claude Code, OpenCode, or Codex-style agents, the “batteries included” package needs more than MCP + LLM switching. It needs a full agent runtime.

Codex CLI can read repositories, edit files, and run commands locally; Codex also supports MCP in CLI and IDE extension contexts. Claude Code is described as a coding assistant that understands a codebase, works across files/tools, and connects to MCP servers. OpenCode exposes terminal/desktop/IDE modes, model-provider switching, agents, and MCP management. ([OpenAI Developers][1])

Your batteries-included agent should have these capability layers:

Core loop.

It needs a provider-independent agent loop: user input → model call → tool call detection → permission check → tool execution → tool result injection → repeat → final answer. This should support streaming, multiple tool calls, cancellation, retries, max-steps, timeouts, and structured logs.

Tool system.

It should accept any tool source, not only MCP. You want one normalized interface:

```ts
type ToolProvider = {
  listTools(): Promise<ToolDefinition[]>
  callTool(call: ToolCall, context: ToolContext): Promise<ToolResult>
}
```

Then MCP, local functions, shell commands, file tools, browser tools, GitHub tools, and internal APIs all become interchangeable providers.

Model adapter.

It needs a normalized model interface for OpenAI, Anthropic, Ollama, local HTTP servers, etc. The difficult part is not calling the models; it is normalizing tool-call formats, streaming deltas, context limits, reasoning/tool events, JSON mode, and error handling.

Workspace awareness.

For coding-agent parity, the agent needs tools for:

```text
read file
write file
edit file by patch
list directory
search files
grep/ripgrep
parse project tree
inspect package files
read git diff
```

Without this, it is just a chatbot with tools.

Shell execution.

It needs controlled command execution:

```text
run command
stream stdout/stderr
set cwd/env
timeout commands
kill processes
classify risky commands
ask permission before destructive actions
```

This is a major capability boundary. Coding agents become useful when they can run tests, linters, builds, package managers, and scripts.

Patch/edit engine.

Do not only expose `writeFile`. You need a robust edit system:

```text
apply unified diff
replace range
create file
delete file
rename file
format changed files
detect conflicts
rollback failed patches
show proposed diff before applying
```

Good coding agents are good partly because they can make precise multi-file edits.

Permission and policy system.

This is mandatory.

You need configurable policies for:

```text
read workspace
write workspace
run safe command
run risky command
network access
MCP tool call
secret access
external file access
destructive command
```

The host/app should be able to decide whether a tool call is auto-approved, denied, or requires user confirmation.

Context management.

This is one of the hardest parts.

The agent needs to decide what to put into the model context:

```text
chat history
system/developer instructions
repo summary
relevant files
git diff
tool results
errors
previous plans
project conventions
```

It also needs summarization/compression when context grows too large.

Planning mode.

Claude Code/OpenCode-style systems often distinguish between “plan” and “act.” Your agent should support:

```text
read-only planning
propose changes
ask for approval
execute plan
resume from plan
```

This is useful for trust and safety.

Session state.

It needs persistent sessions:

```text
conversation history
tool call history
working directory
enabled tools
model/provider choice
MCP server state
approval decisions
summaries
checkpoints
```

This allows “continue where we left off.”

Git integration.

For coding parity, add:

```text
status
diff
branch
commit
restore file
checkpoint before edits
show changed files
```

Even if you do not automate commits initially, the agent should understand git state.

MCP integration.

The batteries package should be able to accept MCP runtimes, but not require them.

```ts
const agent = createAgent({
  model,
  tools: [
    fileTools({ root }),
    shellTools({ root }),
    mcpRuntime,
    internalTools
  ]
})
```

Codex and Claude Code both support MCP as a way to connect to external tools and context; for your system, MCP should be one plugin type, not the core abstraction. ([OpenAI Developers][2])

Subagents.

For higher capability, support specialized agents:

```text
planner
coder
reviewer
debugger
test-runner
docs-writer
security-reviewer
```

OpenCode explicitly supports configurable agents and subagents. ([OpenCode][3])

Observability.

You need logs and events:

```ts
on("model_start")
on("model_delta")
on("tool_call")
on("tool_result")
on("permission_request")
on("file_changed")
on("error")
on("final")
```

Without this, building a UI or CLI on top becomes painful.

A strong package design would look like this:

```text
@scope/agent
- provider-independent agent loop
- tool routing
- permissions
- planning/act modes
- session state
- event stream

@scope/llm
- OpenAI/Anthropic/Ollama/local adapters

@scope/tools
- file, shell, git, search, browser tools

@scope/mcp-runtime
- MCP lifecycle and tool provider implementation

@scope/mcp-registry
- registry search and install-plan generation

@scope/all
- batteries-included convenience wrapper
```

The minimum viable “Claude Code-like” version is:

```text
agent loop
LLM adapter
file read/write/edit tools
shell tool
git diff/status
permission system
MCP tool provider
streaming events
session persistence
```

Without file tools and shell execution, it will not feel like Claude Code/Codex. Without permissions and diff/checkpointing, it will not be safe enough to trust.

[1]: https://developers.openai.com/codex/cli?utm_source=chatgpt.com "CLI – Codex"
[2]: https://developers.openai.com/codex/mcp?utm_source=chatgpt.com "Model Context Protocol – Codex"
[3]: https://opencode.ai/docs/agents/?utm_source=chatgpt.com "Agents"
