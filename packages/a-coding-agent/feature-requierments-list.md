1. Agent Runtime Core
   - Multi-step agent loop
   - Tool-call handling
   - Streaming responses
   - Cancellation
   - Retry logic
   - Max-step limits
   - Error recovery
   - Event system

2. LLM Adapter Layer
   - OpenAI adapter
   - Anthropic adapter
   - Ollama adapter
   - Local HTTP model adapter
   - Normalized message format
   - Normalized tool-call format
   - Streaming normalization
   - Context-window handling

3. Tool System
   - Generic ToolProvider interface
   - Tool discovery
   - Tool execution
   - Tool result normalization
   - Tool routing
   - Tool permissions
   - Tool timeouts

4. Workspace Tools
   - Read file
   - Write file
   - Edit file
   - Apply patch
   - List directory
   - Search files
   - Grep/ripgrep
   - Project tree summary
   - Detect file changes

5. Shell Tools
   - Run command
   - Stream stdout/stderr
   - Set cwd/env
   - Timeout handling
   - Kill process
   - Classify risky commands
   - Require approval for dangerous commands

6. Git Tools
   - Git status
   - Git diff
   - Current branch
   - Changed files
   - Restore file
   - Create checkpoint
   - Optional commit helper

7. MCP Runtime Integration
   - stdio transport
   - HTTP transport
   - Server lifecycle
   - Initialize handshake
   - Tool discovery
   - Tool execution
   - Server restart
   - Server shutdown

8. MCP Registry Integration
   - Search registry
   - Fetch server metadata
   - Generate install plan
   - Generate MCP config
   - Validate package metadata
   - UI-friendly registry data

9. Permission System
   - Read permissions
   - Write permissions
   - Shell permissions
   - Network permissions
   - MCP tool permissions
   - Secret access permissions
   - Auto-approve rules
   - Deny rules
   - User confirmation hooks

10. Context Management
   - Chat history
   - Tool result history
   - Relevant file selection
   - Repository summary
   - Git diff context
   - Context compression
   - Session summaries
   - Token budget management

11. Planning and Execution Modes
   - Ask mode
   - Plan mode
   - Act mode
   - Review mode
   - Approval before edits
   - Resume plan
   - Abort plan

12. Session State
   - Persistent conversations
   - Enabled tools
   - Model selection
   - Working directory
   - MCP server state
   - Approval history
   - Checkpoints
   - Resume session

13. Subagents
   - Planner
   - Coder
   - Reviewer
   - Debugger
   - Test runner
   - Documentation writer
   - Custom subagents

14. Observability
   - Tool-call logs
   - Model-call logs
   - Token usage
   - Cost tracking
   - File-change events
   - Permission events
   - Error events
   - Debug traces

15. Safety and Recovery
   - Dry-run mode
   - Diff preview
   - Rollback
   - Command sandboxing
   - Path restrictions
   - Secret redaction
   - Rate limits
   - Infinite-loop protection

16. UI/CLI Integration Hooks
   - Event stream API
   - Progress updates
   - Permission prompt hooks
   - Diff viewer hooks
   - Tool result renderer hooks
   - Chat message renderer hooks
   - Status indicators

17. Configuration
   - Project config file
   - User config file
   - Environment variables
   - Model config
   - Tool config
   - MCP server config
   - Policy config
   - Profiles/presets

18. Batteries-Included Presets
   - Minimal chat agent
   - Local coding agent
   - MCP-enabled agent
   - Read-only reviewer
   - Autonomous test-fix agent
   - Enterprise locked-down agent