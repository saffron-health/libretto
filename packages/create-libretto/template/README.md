# {{projectName}}

Browser automations built with [Libretto](https://libretto.sh).

## Quick Start

Open a page interactively to inspect and prototype:

```bash
{{runCommand}} libretto open https://example.com --headed
```

Run a workflow:

```bash
{{runCommand}} libretto run src/workflows/star-repo.ts
```

## Agent Skills

Libretto ships with agent skills that let AI coding assistants (Claude Code, Codex, etc.) build and maintain workflows for you. After running `{{runCommand}} libretto setup`, the skill files are installed at the root of your project in `.agents/skills/` and `.claude/skills/`. These root-level skill directories are what your AI assistant reads to understand how to use Libretto.

## Links

- [Website](https://libretto.sh)
- [Documentation](https://libretto.sh/get-started/introduction)
- [CLI Reference](https://libretto.sh/cli-reference/open-and-connect)
- [Library API Reference](https://libretto.sh/library-api/workflow)
- [GitHub](https://github.com/saffron-health/libretto)
