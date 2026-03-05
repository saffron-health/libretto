# Claude Prompting

Claude-specific patterns and behaviors for system prompts.

## XML Structure

Claude is specifically trained on XML tags. Use them for logical sections:

```
<identity>
You are a code reviewer.
</identity>

<rules>
- Review for correctness first
- Check for security issues
- Suggest improvements only when significant
</rules>
```

Do not use XML to wrap user input in separate messages. XML works best in system prompts for structural organization.

## Default Behaviors to Counter

### List Overuse

Claude defaults to bullet points for everything. Counter with explicit instructions:

```
Use paragraphs for explanations. Reserve lists for genuinely enumerable items like file paths or error messages.
```

A single instruction often fails. Reinforce in multiple places if the behavior persists.

### Sycophancy

Claude tends to praise user ideas and questions. Counter with:

```
Skip flattery. Do not say ideas are "great" or "interesting". Respond directly to the substance.
```

### Suggests Instead of Implements

Claude defaults to describing what it would do rather than doing it. Counter with:

```
Implement changes directly. Do not describe what you would do or ask for permission to proceed.
```

This is the "default to action" pattern. Without it, Claude will often output plans instead of executing them.

## Trigger Words

Certain phrases cause aggressive tool use:

- "deep dive" - triggers 5+ tool calls
- "comprehensive" - extensive searching
- "analyze thoroughly" - over-investigation

Use these intentionally or avoid them if you want focused behavior.

## Parallel Tool Execution

Claude (especially Sonnet) aggressively parallelizes tool calls by default. To tune this:

```
# For more parallelism
When multiple files need reading, read them all in parallel.

# For less parallelism
Complete one file's analysis before moving to the next.
```

## Message Separation

Separating system and user content into distinct messages improves Claude's performance. This is opposite of GPT models where combining works better.

## Thinking Blocks

Claude supports structured reasoning with thinking tags:

```
<thinking>
The user wants X. I should check Y first because Z.
</thinking>
```

Interleaved thinking allows tool execution during reasoning, useful for complex multi-step tasks.

## Explicit Instructions Required

Claude 4.x requires more explicit instructions than earlier versions. Behaviors that were implicit now need stating:

```
# Previously implicit, now needs explicit instruction
Go above and beyond the literal request when it serves the user's underlying goal.
```
