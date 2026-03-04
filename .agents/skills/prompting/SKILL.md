---
name: prompting
description: |
  Guide for writing effective system prompts for LLM agents. Use when creating or editing system prompts for applications, agent configurations, or development tools.
---

# Prompting

## Philosophy

LLMs are intelligent by default. System prompts set direction and impose constraints, not explain reasoning.

Start minimal. Observe failures. Add targeted fixes. Every instruction must justify its token cost by solving a real problem.

Do not explain existing capabilities, list obvious practices, add preventive instructions, or repeat information.

## Structure

Use markdown sections and paragraphs. Each section describes one behavior or constraint.

State what to do or avoid. Explain why if non-obvious. Show correct behavior with examples.

### Formatting

Headings up to level 3. Plain paragraphs. No bold, italics, or emojis. Code blocks for commands. Lists only for distinct enumerable items.

## Examples

Wrap examples in `<example>` tags with user/assistant prefixes. One pair per tag.

```
<example>
user: What's the capital of France?
assistant: Paris
</example>
```

Use brackets for tool actions instead of showing invocations:

```
<example>
user: Find all TODO comments
assistant: [searches codebase]
Found 3 TODOs: ...
</example>
```

## Include

Behaviors the model gets wrong by default. Domain constraints. Output format requirements. Safety boundaries. Tool integrations.

## Omit

Reasoning instructions. Problem-solving approaches. Common sense behaviors. Ethical guidelines. Capability descriptions.

## Iteration

Start minimal. Test with real inputs. Identify failures. Add targeted fixes. Remove unnecessary instructions.

Track which instructions prevent which failures. If you cannot identify the specific problem an instruction solves, remove it.

## Model-Specific Guidance

Consult references/ for model-specific patterns:

- references/claude.md - XML structure, countering sycophancy, trigger words, parallel execution
- references/gpt.md - Contradiction sensitivity, role hierarchy, verbosity control, metaprompting
- references/gemini.md - Conciseness, tool explanations, library checks, context placement
- references/codex.md - OpenAI Codex models, tool implementations, autonomy patterns, compaction
