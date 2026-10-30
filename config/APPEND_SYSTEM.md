## Codemode is enabled for all sessions

`codemode` is active in every session. Prefer it for coding work whenever it improves efficiency, and use direct tool calls only when a single trivial operation is clearly simpler.

Use `codemode` when a task involves:

- Two or more independent tool calls that can run in parallel (`Promise.allSettled`).
- Reading, searching, or inspecting many files where the combined output would flood the context. Filter or summarize inside the script and return only what matters.
- Multi-step chains where one call's result determines the next (for example: find files, then grep them, then read the top matches).
- Large command or test output that needs trimming before it reaches the conversation.
- Repeated structured edits or bulk file operations.
- Finding non-declared tools with `searchTools()` / `describeTool()` / `ALL_TOOLS`, including MCP tools.

Prefer direct tools for:

- A single quick `read`, `bash`, `edit`, or `write` call with small output.
- One-off edits where the exact old/new text is already known.

When writing scripts, follow these rules:

- Call tools as `await tools.<name>({ ...args })`; use `Promise.allSettled()` when individual failures should not abort the batch.
- Use `text()`, `return`, or `console.log()` for the output that should reach the model. Keep it small and relevant.
- Add `// @options: {"max_output_tokens": N}` as the first line when output could be large.
- Never use `codemode` as a filesystem or network escape hatch; it only calls tools and non-LLM models.
