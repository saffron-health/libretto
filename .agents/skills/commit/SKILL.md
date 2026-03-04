---
name: commit
description: Stage all changes and commit with appropriate message, showing changed files and edits. Use when you need to create a git commit.
---

Automatically stage all changes and commit with an appropriate message based on the changes made. Shows a summary of what files were changed and how.

## Steps

1. **Show current status before staging**:

   ```bash
   git status --porcelain
   ```

2. **Stage all changes**:

   ```bash
   git add .
   ```

3. **Get changed files for analysis**:

   ```bash
   git diff --cached --name-only
   ```

4. **Get detailed change summary**:

   ```bash
   git diff --cached --stat
   ```

5. **Analyze changes to create commit message**:
   - Read the changed files to understand the scope of changes
   - Look for spec files in `specs/` directory that might be related to these changes
   - Focus on the main functional changes rather than minor refactoring
   - Create a concise, descriptive commit message following conventional commit format
   - Consider these patterns:
     - `feat: add new feature`
     - `fix: resolve bug in component`
     - `refactor: reorganize utility functions`
     - `docs: update documentation`
     - `chore: update dependencies`

6. **Commit the changes**:

   ```bash
   git commit -m "Generated commit message"
   ```

7. **Show commit summary**:
   ```bash
   git show --stat --oneline HEAD
   ```

## Analysis Guidelines

### Commit Message Format

- Use conventional commit format: `type: description`
- Keep it concise and descriptive
- Focus on what the change accomplishes, not how it was done
- Use imperative mood: "add" not "added"

### Change Analysis Priority

1. **Spec files**: New/modified files in `specs/` indicate major features
2. **Core functionality**: API endpoints, UI components, database schemas
3. **Configuration**: Build, dependency, or environment changes
4. **Documentation**: README, AGENT.md, or other doc updates
5. **Refactoring**: Code reorganization without functional changes

## Example Output

```
Files staged for commit:
 M apps/web/src/components/TaskList.tsx
 A specs/task-filters.md
 M packages/ui/src/Button.tsx
 D apps/web/src/old-component.tsx

Changes summary:
 apps/web/src/components/TaskList.tsx | 15 ++++++++++++---
 specs/task-filters.md                | 42 +++++++++++++++++++++++++++++++++++++++
 packages/ui/src/Button.tsx           |  8 ++++----
 apps/web/src/old-component.tsx       | 23 -----------------------
 4 files changed, 58 insertions(+), 26 deletions(-)

Committed: feat: add task filtering functionality
[main abc1234] feat: add task filtering functionality
 4 files changed, 58 insertions(+), 26 deletions(-)
```

## Error Handling

- If no changes to commit: "No changes to commit"
- If commit fails: Show the specific git error
- If unable to analyze changes: Use generic commit message with timestamp

## File Status Symbols

When showing git status, these symbols indicate:

- `M` = Modified
- `A` = Added (new file)
- `D` = Deleted
- `R` = Renamed
- `C` = Copied
- `??` = Untracked
