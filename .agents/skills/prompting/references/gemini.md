# Gemini Prompting

Gemini-specific patterns and behaviors for system prompts.

## Conciseness

Gemini tends toward verbose output. Add conciseness as a standalone instruction:

```
Be concise.
```

This must be its own line, not buried in a paragraph. Vague instructions like "minimize prose" do not work.

## Tool Call Explanations

Gemini 3 calls tools silently by default. Require explanations:

```
Before calling any tool, state in one sentence what you're doing and why.
```

Without this, users see tool calls with no context.

## Library Assumptions

Gemini assumes common libraries are available without checking. Counter with:

```
Before using any library, verify it exists in the project by checking package.json, requirements.txt, or similar configuration files.
```

This prevents suggestions that reference unavailable dependencies.

## Long Context Placement

For prompts with large data blocks, place instructions after the data:

```
<data>
[large dataset here]
</data>

Based on the data above, extract all email addresses and group by domain.
```

This differs from intuition. Instructions at the end perform better than instructions at the start when data is large.

## Format Consistency

Choose XML or Markdown, not both. Mixing formats causes inconsistent behavior.

XML format:

```xml
<role>
You are a data analyst.
</role>

<constraints>
- Output CSV format only
- Include headers
</constraints>
```

Markdown format:

```markdown
# Role

You are a data analyst.

# Constraints

- Output CSV format only
- Include headers
```

## Constraint Placement

Put behavioral constraints at the top of the prompt, before task instructions:

```
# Constraints
- Maximum 100 words per response
- No external API calls

# Task
Summarize the following document.
```

Constraints placed after tasks are more likely to be ignored.

## Planning Requests

Gemini benefits from explicit planning instructions for complex tasks:

```
Before responding:
1. Identify the sub-tasks required
2. Check if you have all necessary information
3. Create an outline
4. Execute the plan
```

## Context Anchoring

When referencing earlier content, use explicit anchoring:

```
Based on the error message above, suggest three possible fixes.
```

Phrases like "above", "the data provided", "as mentioned" help Gemini connect instructions to context.
