# OpenAI Prompting

OpenAI/GPT-specific patterns and behaviors for system prompts.

## Contradiction Sensitivity

GPT-5 expends reasoning tokens trying to reconcile conflicting instructions. Claude picks one and proceeds. GPT struggles.

Bad:

```
Never schedule without explicit consent.
For urgent cases, auto-assign the earliest slot.
```

These contradict. GPT will degrade trying to reconcile them. Review prompts for logical conflicts before deployment.

## Message Role Hierarchy

OpenAI has strict priority: developer > user.

- `developer` messages define rules and logic
- `user` messages provide inputs

Think of developer as function definition, user as function arguments. Use this for security-sensitive instructions that should not be overridden by user input.

## Few-Shot Examples

Examples help GPT-4 but can hurt GPT-5 reasoning models. For reasoning tasks, prefer clear instructions over examples.

```
# GPT-4: Examples help
user: translate "hello" to French
assistant: bonjour

user: translate "goodbye" to French
assistant: au revoir

# GPT-5: Instructions often better
Translate the input text to French. Preserve tone and formality level.
```

## Verbosity Control

GPT-5 has explicit verbosity parameter. Set globally low, override for specific contexts:

```
Be concise in explanations. Use high verbosity only when writing code.
```

Verbosity may degrade over long conversations. Re-state the instruction every few messages if needed.

## Tool Preambles

GPT models are trained to provide progress updates during tool use:

```
Before calling tools, briefly state what you're doing and why.
```

This improves UX for long-running tasks. The model naturally supports this pattern.

## Reasoning Effort

For complex tasks, GPT-5 benefits from high reasoning effort. For simple tasks, lower effort reduces latency:

```
# Complex analysis
Take time to reason through edge cases before responding.

# Quick lookup
Respond immediately with the answer.
```

## Metaprompting

GPT-5 effectively improves its own prompts. When a prompt produces wrong behavior:

```
Here's a prompt: [PROMPT]

The desired behavior is X, but it does Y instead. What minimal edits would fix this?
```

This often produces usable prompt improvements directly.

## Structure

Use markdown headers for sections, XML tags for logical boundaries within sections:

```
## Tool Guidelines

<file_operations>
- Read files before editing
- Verify changes after writing
</file_operations>

<search>
- Use grep for content search
- Use glob for file patterns
</search>
```

## Explicit Stop Conditions

GPT follows precise instructions well. Define exactly when to stop:

```
Stop when:
- All tests pass
- The user says "done"
- You've made 3 unsuccessful attempts
```

Without clear stop conditions, GPT may continue indefinitely or stop prematurely.
