# Task Tracking Pattern for Browser Automation

This pattern enables async human-bot collaboration on browser automation tasks using a shared markdown file as the interface.

## Overview

**Problem:** Browser automation workflows often require:
- Human assignment ("automate this portal")
- Bot execution (running the automation)
- Progress visibility (is it done? did it fail?)
- Task handoff (human needs to review results)

**Traditional Solution:** Separate task management UI + API + polling + notifications (complex!)

**This Pattern:** A single markdown file synced bi-directionally between human (browser) and bot (local file)

## Architecture

```
Human creates task in TODO.md (browser editor)
  ↓ (sync via Proof/similar)
Bot reads TODO.md on startup
  ↓
Bot executes Libretto automation
  ↓
Bot updates status in TODO.md
  ↓ (sync back)
Human sees result in browser
```

**No API needed.** File IS the interface.

---

## Implementation

### 1. File Format (TODO.md)

```markdown
# TODO - Human ↔ Bot Tasks

## 🔄 Active Tasks

### @bot: Scrape patient eligibility from Availity
**Assigned:** 2026-03-23 14:30 (by @human)
**Status:** 🔄 IN PROGRESS
**Priority:** HIGH
**Session:** availity-eligibility

**Context:**
Need to check insurance eligibility for patient ID 12345.
Portal: https://apps.availity.com
Credentials: Use saved profile

**Requirements:**
1. Login to Availity
2. Navigate to eligibility check
3. Enter patient DOB: 1990-01-15
4. Enter insurance ID: ABC123456
5. Extract eligibility status + coverage details
6. Return structured result

**Bot's Progress:**
- 14:31 - Session started (availity-eligibility)
- 14:32 - Login successful
- 14:33 - Navigated to eligibility section
- 14:34 - Entered patient info
- 14:35 - ✅ COMPLETE - Eligibility: Active, Coverage: Full

**Result:**
```json
{
  "status": "Active",
  "coverage": "Full - Medical, Dental, Vision",
  "effectiveDate": "2026-01-01",
  "copay": "$25",
  "deductible": "$500 ($150 met)"
}
```

---

### @bot: Debug broken automation script
**Assigned:** 2026-03-23 15:00 (by @human)
**Status:** ⏸️ BLOCKED
**Priority:** MEDIUM
**Session:** debug-ecw-script

**Context:**
Automation for EClinicalWorks is failing with selector error.
Script: ./scripts/ecw-patient-lookup.ts

**Bot's Progress:**
- 15:01 - Reproduced error locally
- 15:02 - Selector '.patient-search-btn' not found
- 15:03 - Used Libretto snapshot to inspect page
- 15:04 - Found issue: Button class changed to '.search-patient-btn'
- 15:05 - ⏸️ BLOCKED - Need human approval to update script

**Proposed Fix:**
Change line 45: `.patient-search-btn` → `.search-patient-btn`

**Waiting On:** @human to approve change
```

---

## Status Emojis

- 📋 **PROPOSED** - Task created, not started
- 🔄 **IN PROGRESS** - Bot actively working
- ✅ **DONE** - Completed successfully
- ⏸️ **BLOCKED** - Waiting on human input
- ❌ **CANCELLED** - Task abandoned
- 🔥 **URGENT** - High priority, do first

---

## 2. Bot Implementation (Session Startup)

```typescript
// Add to session startup sequence
async function checkTasks() {
  const todoPath = path.join(workspace, 'TODO.md')
  const content = await fs.readFile(todoPath, 'utf-8')
  
  const tasks = parseTasksForBot(content)  // Extract @bot assignments
  const activeTasks = tasks.filter(t => t.status === 'PROPOSED' || t.status === 'IN PROGRESS')
  
  if (activeTasks.length === 0) {
    console.log('No active tasks assigned to bot')
    return
  }
  
  // Execute highest priority task
  const task = activeTasks.sort((a, b) => {
    const priority = { HIGH: 3, MEDIUM: 2, LOW: 1 }
    return priority[b.priority] - priority[a.priority]
  })[0]
  
  console.log(`Executing task: ${task.title}`)
  await executeTask(task)
}

async function executeTask(task: Task) {
  // Update status to IN PROGRESS
  await updateTaskStatus(task.id, 'IN PROGRESS', 'Task started')
  
  try {
    // Execute Libretto automation based on task context
    const sessionName = task.session || 'default'
    
    // Example: Run automation
    await exec(`npx libretto open "${task.portalUrl}" --session ${sessionName}`)
    // ... automation steps based on task.requirements
    
    // Update with result
    await updateTaskStatus(task.id, 'DONE', `Result: ${JSON.stringify(result)}`)
    
  } catch (error) {
    // If error, mark as blocked with details
    await updateTaskStatus(task.id, 'BLOCKED', `Error: ${error.message}`)
  }
}
```

---

## 3. Task Parser

```typescript
interface Task {
  id: string           // Generated from title
  title: string        // @bot: [title]
  assignee: string     // bot or human
  assigner: string     // who created it
  status: 'PROPOSED' | 'IN PROGRESS' | 'DONE' | 'BLOCKED' | 'CANCELLED' | 'URGENT'
  priority: 'HIGH' | 'MEDIUM' | 'LOW'
  assigned: string     // ISO date
  session?: string     // Libretto session name
  context: string      // Full context section
  requirements: string[] // Extracted list items
  progress: string[]   // Progress log entries
  result?: any         // Structured result if available
}

function parseTasksForBot(markdown: string): Task[] {
  const tasks: Task[] = []
  const sections = markdown.split(/^### @/m).slice(1)
  
  for (const section of sections) {
    const lines = section.split('\n')
    const header = lines[0]
    
    // Parse assignee and title
    const match = header.match(/^(\w+):\s*(.+)/)
    if (!match || match[1] !== 'bot') continue  // Only bot tasks
    
    const title = match[2]
    const body = lines.slice(1).join('\n')
    
    // Extract fields
    const assigned = body.match(/\*\*Assigned:\*\*\s*(.+)/)?.[1]
    const status = body.match(/\*\*Status:\*\*\s*[🔄✅⏸️❌📋🔥]\s*(\w+)/)?.[1]
    const priority = body.match(/\*\*Priority:\*\*\s*(\w+)/)?.[1]
    const session = body.match(/\*\*Session:\*\*\s*(.+)/)?.[1]
    
    // Extract context
    const contextMatch = body.match(/\*\*Context:\*\*\s*\n([\s\S]+?)\n\*\*/m)
    const context = contextMatch?.[1].trim() || ''
    
    // Extract requirements list
    const reqMatch = body.match(/\*\*Requirements:\*\*\s*\n((?:\d+\..+\n?)+)/m)
    const requirements = reqMatch?.[1]
      .split('\n')
      .map(line => line.replace(/^\d+\.\s*/, '').trim())
      .filter(Boolean) || []
    
    // Extract progress
    const progressMatch = body.match(/\*\*Bot's Progress:\*\*\s*\n((?:-.+\n?)+)/m)
    const progress = progressMatch?.[1]
      .split('\n')
      .map(line => line.replace(/^-\s*/, '').trim())
      .filter(Boolean) || []
    
    tasks.push({
      id: title.toLowerCase().replace(/\s+/g, '-'),
      title,
      assignee: 'bot',
      assigner: assigned?.match(/by @(\w+)/)?.[1] || 'unknown',
      status: status as Task['status'] || 'PROPOSED',
      priority: priority as Task['priority'] || 'MEDIUM',
      assigned: assigned?.match(/\d{4}-\d{2}-\d{2}/)?.[0] || new Date().toISOString().split('T')[0],
      session,
      context,
      requirements,
      progress,
    })
  }
  
  return tasks
}
```

---

## 4. Sync Layer

**Option A: Polling (Simple)**

```typescript
// Poll TODO.md every 5 seconds
setInterval(async () => {
  const content = await fs.readFile(todoPath, 'utf-8')
  if (content !== lastContent) {
    lastContent = content
    await checkTasks()  // Re-check for new assignments
  }
}, 5000)
```

**Option B: File Watcher (Faster)**

```typescript
import chokidar from 'chokidar'

const watcher = chokidar.watch(todoPath)
watcher.on('change', async () => {
  await checkTasks()  // Immediate reaction
})
```

**Option C: Proof SDK (Collaborative)**

```typescript
import { ProofClient } from '@proof-sdk/client'

const proof = new ProofClient('http://localhost:4000')
const doc = await proof.getDocument('todo-doc-slug', accessToken)

// Poll Proof for changes (human edits in browser)
setInterval(async () => {
  const latest = await proof.getMarkdown(doc.slug, accessToken)
  if (latest !== lastContent) {
    // Sync to local file
    await fs.writeFile(todoPath, latest)
    await checkTasks()
  }
}, 2000)
```

---

## 5. Status Update Helper

```typescript
async function updateTaskStatus(taskId: string, status: Task['status'], message: string) {
  const content = await fs.readFile(todoPath, 'utf-8')
  
  // Find task section
  const taskPattern = new RegExp(`(### @bot: [^\\n]+\\n[\\s\\S]+?id: ${taskId}[\\s\\S]+?)\\*\\*Status:\\*\\*[^\\n]+`, 'i')
  
  const emoji = {
    PROPOSED: '📋',
    'IN PROGRESS': '🔄',
    DONE: '✅',
    BLOCKED: '⏸️',
    CANCELLED: '❌',
    URGENT: '🔥'
  }
  
  const timestamp = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
  
  const updated = content.replace(taskPattern, (match) => {
    // Update status line
    let result = match.replace(/\*\*Status:\*\*[^\n]+/, `**Status:** ${emoji[status]} ${status}`)
    
    // Add progress entry
    const progressSection = result.match(/(\*\*Bot's Progress:\*\*\s*\n(?:-.+\n?)*)/)?.[0] || '**Bot\'s Progress:**\n'
    const newProgress = `${progressSection}- ${timestamp} - ${message}\n`
    result = result.replace(/\*\*Bot's Progress:\*\*[^\n]*\n(?:-.+\n?)*/, newProgress)
    
    return result
  })
  
  await fs.writeFile(todoPath, updated)
  
  // If using Proof, sync back
  if (proofEnabled) {
    await proof.replace(doc.slug, accessToken, updated)
  }
}
```

---

## Real-World Example: Healthcare Portal Automation

### Human Creates Task (Browser)

Opens TODO.md in Proof at `http://localhost:4000/doc/xyz`

```markdown
### @bot: Check eligibility for 5 patients
**Assigned:** 2026-03-23 10:00 (by @sarah)
**Status:** 📋 PROPOSED
**Priority:** HIGH
**Session:** batch-eligibility-check

**Context:**
Need to verify insurance eligibility for today's appointments.
Portal: Availity
Use saved credentials.

**Requirements:**
1. Login to Availity
2. For each patient in attached CSV:
   - Navigate to eligibility check
   - Enter patient info (DOB, insurance ID)
   - Extract status, coverage, copay
3. Save results to results.json
4. If any patient is INACTIVE, flag for review

**Patients:**
- John Doe, 1985-03-15, INS001
- Jane Smith, 1990-07-22, INS002
- Bob Johnson, 1978-11-30, INS003
- Alice Williams, 1995-02-14, INS004
- Charlie Brown, 1982-09-08, INS005
```

Saves → Proof syncs to local TODO.md

---

### Bot Executes (Automated)

```typescript
// Session startup detects new task
const task = parseTasksForBot(todoContent)[0]

await updateTaskStatus(task.id, 'IN PROGRESS', 'Starting batch eligibility check')

const sessionName = 'batch-eligibility-check'
await exec(`npx libretto open "https://apps.availity.com" --session ${sessionName} --headless`)

// Login (using saved profile)
await updateTaskStatus(task.id, 'IN PROGRESS', 'Logged in successfully')

const results = []

for (const patient of task.patients) {
  await updateTaskStatus(task.id, 'IN PROGRESS', `Checking ${patient.name}...`)
  
  // Navigate and fill form
  await exec(`npx libretto exec --session ${sessionName} \
    "await page.locator('#firstName').fill('${patient.name.split(' ')[0]}');\
     await page.locator('#dob').fill('${patient.dob}');\
     await page.locator('#insuranceId').fill('${patient.insuranceId}');\
     await page.locator('button:has-text(\"Check Eligibility\")').click();\
     await page.waitForSelector('.eligibility-result')"`)
  
  // Extract result
  const result = await exec(`npx libretto exec --session ${sessionName} --json \
    "return {\
      name: '${patient.name}',\
      status: await page.locator('.eligibility-status').textContent(),\
      coverage: await page.locator('.coverage-details').textContent(),\
      copay: await page.locator('.copay-amount').textContent()\
    }"`)
  
  results.push(JSON.parse(result.stdout))
  
  // Flag if inactive
  if (result.status === 'INACTIVE') {
    await updateTaskStatus(task.id, 'IN PROGRESS', `⚠️ ${patient.name} is INACTIVE - needs review`)
  }
}

// Save results
await fs.writeFile('results.json', JSON.stringify(results, null, 2))

// Mark complete
await updateTaskStatus(task.id, 'DONE', `All 5 patients checked. Results saved to results.json`)

await exec(`npx libretto close --session ${sessionName}`)
```

---

### Human Reviews Result (Browser)

Refreshes Proof → sees updated TODO.md:

```markdown
### @bot: Check eligibility for 5 patients
**Assigned:** 2026-03-23 10:00 (by @sarah)
**Status:** ✅ DONE
**Priority:** HIGH
**Session:** batch-eligibility-check

[...context and requirements unchanged...]

**Bot's Progress:**
- 10:01 - Starting batch eligibility check
- 10:02 - Logged in successfully
- 10:03 - Checking John Doe...
- 10:04 - Checking Jane Smith...
- 10:05 - Checking Bob Johnson...
- 10:06 - ⚠️ Bob Johnson is INACTIVE - needs review
- 10:07 - Checking Alice Williams...
- 10:08 - Checking Charlie Brown...
- 10:09 - ✅ All 5 patients checked. Results saved to results.json

**Results:**
See `results.json` for full details.
⚠️ **Action needed:** Bob Johnson (INACTIVE) - verify insurance status.
```

Sarah sees the results immediately, knows Bob needs follow-up, downloads results.json.

---

## Benefits

**For Humans:**
- ✅ No separate UI to learn
- ✅ Markdown is familiar
- ✅ Full audit trail (progress log)
- ✅ Can edit/cancel tasks mid-execution
- ✅ Works in any editor (Proof, VS Code, Notion, etc.)

**For Bots:**
- ✅ Simple parsing (just markdown)
- ✅ Clear structure (no ambiguity)
- ✅ Easy to update (string replacement)
- ✅ No API to maintain
- ✅ Works offline (file-based)

**For Teams:**
- ✅ Async collaboration (no coordination needed)
- ✅ Version control (git-friendly)
- ✅ Searchable (grep works)
- ✅ Portable (just a file)
- ✅ Privacy (stays local unless shared)

---

## Variations

### Multi-Bot Assignment

```markdown
### @bot-production: Check live portal
### @bot-staging: Test new automation
### @bot-qa: Verify both match
```

### Scheduling

```markdown
**Due:** 2026-03-23 18:00
**Repeat:** Daily at 09:00
```

### Dependencies

```markdown
**Depends On:** @bot-staging task completion
**Blocks:** @human review-results task
```

### Notifications

```markdown
**Notify:** @sarah (Slack) when DONE
**Alert:** @ops (PagerDuty) if BLOCKED
```

---

## Anti-Patterns

❌ **Don't:** Make tasks too granular (creates noise)
✅ **Do:** Group related steps into one task

❌ **Don't:** Mix multiple workflows in one file
✅ **Do:** Use separate files (TODO-eligibility.md, TODO-reports.md)

❌ **Don't:** Let completed tasks pile up
✅ **Do:** Archive to DONE-2026-03.md monthly

❌ **Don't:** Put sensitive data in tasks (passwords, PHI)
✅ **Do:** Reference secure storage ("Use saved credentials")

❌ **Don't:** Assume instant sync (file/network delays)
✅ **Do:** Poll every 2-5 seconds, handle stale reads

---

## Integration with Libretto

This pattern works perfectly with Libretto because:

1. **Session Management:** Each task can have a dedicated Libretto session
2. **Saved Profiles:** Reuse auth across tasks (`npx libretto save <domain>`)
3. **Network Capture:** Debug failed tasks with `npx libretto network`
4. **Snapshot Analysis:** Bot can request help via `npx libretto snapshot`
5. **Action Replay:** Human can review what bot did via `npx libretto actions`

---

## Getting Started

**1. Create TODO.md in your project:**
```bash
touch TODO.md
```

**2. Add first task:**
```markdown
### @bot: Test Libretto setup
**Assigned:** [today] (by @you)
**Status:** 📋 PROPOSED
**Priority:** LOW

**Context:**
Verify Libretto works with this pattern.

**Requirements:**
1. Open https://example.com
2. Take screenshot
3. Report success
```

**3. Add parser to session startup:**
```typescript
// In your bot's startup sequence
await checkTasks()
```

**4. Watch it work:**
Bot sees task → executes → updates status → you see result!

---

## Further Reading

- [Libretto Documentation](https://github.com/saffron-health/libretto)
- [Proof SDK](https://github.com/EveryInc/proof-sdk) (for collaborative editing)
- [Markdown Task Formats](https://github.com/topics/task-management-markdown)

---

**Maintained by:** Community  
**License:** MIT (same as Libretto)
