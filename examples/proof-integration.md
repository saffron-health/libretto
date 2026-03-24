# Proof + Libretto Integration

Save Libretto automation sessions to Proof documents for collaborative review, debugging, and knowledge sharing.

## Overview

**Proof** is a collaborative markdown document platform with full version control and provenance tracking.

**Use Case:** After running a Libretto automation (especially when debugging or training), save the session logs, network requests, and actions to a Proof document where your team can review, annotate, and discuss.

## Why This Matters

**Problem:** Browser automation debugging is often isolated
- Logs stay on the bot's machine
- Screenshots aren't easily shareable
- Network requests are hard to review
- Knowledge doesn't transfer to team

**Solution:** Libretto session → Proof document → Team collaboration

---

## Quick Start

### 1. Install Proof SDK

```bash
npm install @proof-sdk/client
```

### 2. Start Proof Server (Local or Remote)

```bash
# Local development
npx proof-server

# Or use hosted Proof instance
# export PROOF_URL=https://your-proof-server.com
```

### 3. Add Session Export Helper

```typescript
// save-session-to-proof.ts
import { ProofClient } from '@proof-sdk/client'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'

const execAsync = promisify(exec)

interface LibrettoSession {
  name: string
  url: string
  network: any[]
  actions: any[]
  logs: string[]
  screenshots?: string[]
}

async function getLibrettoSession(sessionName: string): Promise<LibrettoSession> {
  // Get network requests
  const { stdout: networkJson } = await execAsync(
    `npx libretto network --session ${sessionName} --json`
  )
  const network = JSON.parse(networkJson)
  
  // Get actions
  const { stdout: actionsJson } = await execAsync(
    `npx libretto actions --session ${sessionName} --json`
  )
  const actions = JSON.parse(actionsJson)
  
  // Get logs
  const logsPath = `.libretto/sessions/${sessionName}/logs.jsonl`
  const logsContent = await fs.readFile(logsPath, 'utf-8')
  const logs = logsContent.split('\n').filter(Boolean).map(JSON.parse)
  
  return {
    name: sessionName,
    url: actions[0]?.url || 'unknown',
    network,
    actions,
    logs,
  }
}

async function saveSessionToProof(
  sessionName: string,
  options: {
    proofUrl?: string
    title?: string
    includeScreenshots?: boolean
  } = {}
): Promise<{ slug: string; url: string; accessToken: string }> {
  const proof = new ProofClient(options.proofUrl || 'http://localhost:4000')
  
  // Collect session data
  const session = await getLibrettoSession(sessionName)
  
  // Build markdown document
  const markdown = `
# Libretto Session: ${session.name}

**URL:** ${session.url}  
**Captured:** ${new Date().toISOString()}  
**Actions:** ${session.actions.length}  
**Network Requests:** ${session.network.length}

---

## Actions Performed

${session.actions.map((action, i) => `
### ${i + 1}. ${action.type}

**Selector:** \`${action.selector || 'N/A'}\`  
**Timestamp:** ${action.timestamp}

${action.error ? `**Error:** ${action.error}` : ''}
`).join('\n')}

---

## Network Requests

${session.network.map((req, i) => `
### ${i + 1}. ${req.method} ${req.url}

**Status:** ${req.status}  
**Duration:** ${req.duration}ms  
**Size:** ${req.size} bytes

${req.error ? `**Error:** ${req.error}` : ''}

<details>
<summary>Headers</summary>

\`\`\`json
${JSON.stringify(req.headers, null, 2)}
\`\`\`
</details>

${req.body ? `
<details>
<summary>Request Body</summary>

\`\`\`json
${JSON.stringify(req.body, null, 2)}
\`\`\`
</details>
` : ''}

${req.response ? `
<details>
<summary>Response</summary>

\`\`\`json
${JSON.stringify(req.response, null, 2)}
\`\`\`
</details>
` : ''}
`).join('\n')}

---

## Session Logs

\`\`\`
${session.logs.map(log => `[${log.level}] ${log.timestamp}: ${log.message}`).join('\n')}
\`\`\`

---

## Review Checklist

- [ ] Actions look correct?
- [ ] Network requests as expected?
- [ ] Any errors to investigate?
- [ ] Can this be optimized?

**Add your comments below** ↓
  `.trim()
  
  // Create Proof document
  const doc = await proof.create({
    title: options.title || `Libretto: ${session.name}`,
    markdown,
  })
  
  console.log(`Session saved to Proof: ${doc.url}`)
  
  return {
    slug: doc.slug,
    url: doc.url,
    accessToken: doc.accessToken,
  }
}

export { saveSessionToProof }
```

---

## Usage Examples

### Basic: Save After Automation

```typescript
import { saveSessionToProof } from './save-session-to-proof'

async function runAutomation() {
  const sessionName = 'eligibility-check'
  
  // Run Libretto automation
  await exec(`npx libretto open "https://apps.availity.com" --session ${sessionName}`)
  await exec(`npx libretto exec --session ${sessionName} \
    "await page.locator('#login').click()"`)
  // ... more automation
  
  // Save to Proof for team review
  const proofDoc = await saveSessionToProof(sessionName, {
    title: 'Availity Eligibility Check - Debug Session',
  })
  
  console.log(`Review session at: ${proofDoc.url}`)
  
  // Close Libretto session
  await exec(`npx libretto close --session ${sessionName}`)
}
```

---

### Advanced: Collaborative Debugging

```typescript
async function debugWithTeam(sessionName: string, issue: string) {
  // Run problematic automation
  try {
    await runAutomation(sessionName)
  } catch (error) {
    console.log('Automation failed, saving session for team review...')
    
    const proofDoc = await saveSessionToProof(sessionName, {
      title: `🐛 Debug: ${issue}`,
    })
    
    // Add context to the document
    await proof.edit(proofDoc.slug, proofDoc.accessToken, {
      operations: [{
        type: 'insert_after',
        blockId: 'title',
        content: [
          {
            type: 'paragraph',
            text: `**Issue:** ${issue}`,
          },
          {
            type: 'paragraph',
            text: `**Error:** ${error.message}`,
          },
          {
            type: 'paragraph',
            text: `**Reporter:** Bot (automated)`,
          },
          {
            type: 'paragraph',
            text: `**Status:** Needs human review`,
          },
        ],
      }],
    })
    
    // Notify team (Slack, email, etc.)
    await notifyTeam({
      message: `Automation failed: ${issue}`,
      proofUrl: proofDoc.url,
      assignee: '@sarah',
    })
    
    throw error  // Re-throw for error handling
  }
}
```

---

### Training: Build Knowledge Base

```typescript
async function trainOnWorkflow(workflowName: string) {
  const sessionName = `training-${workflowName}`
  
  console.log('Recording workflow for training...')
  
  // Run workflow in headed mode (human performs steps)
  await exec(`npx libretto open "https://portal.com" --session ${sessionName} --headed`)
  
  console.log('Perform the workflow in the browser, then press Enter...')
  await new Promise(resolve => process.stdin.once('data', resolve))
  
  // Save as training material
  const proofDoc = await saveSessionToProof(sessionName, {
    title: `📚 Training: ${workflowName}`,
  })
  
  // Add training context
  await proof.edit(proofDoc.slug, proofDoc.accessToken, {
    operations: [{
      type: 'insert_after',
      blockId: 'title',
      content: [{
        type: 'heading',
        level: 2,
        text: 'Training Notes',
      }, {
        type: 'paragraph',
        text: 'This session shows the correct way to perform this workflow.',
      }, {
        type: 'heading',
        level: 3,
        text: 'Key Steps',
      }, {
        type: 'bulletList',
        items: [
          'Watch the actions sequence',
          'Note the network requests (shows API calls)',
          'Copy selectors for automation',
          'Identify timing/wait points',
        ],
      }],
    }],
  })
  
  console.log(`Training material saved: ${proofDoc.url}`)
  
  return proofDoc
}
```

---

## Integration with Task Tracking

Combine with the task tracking pattern for full workflow visibility:

```typescript
// In task execution
async function executeTask(task: Task) {
  const sessionName = task.session || `task-${task.id}`
  
  await updateTaskStatus(task.id, 'IN PROGRESS', `Starting session: ${sessionName}`)
  
  try {
    // Run automation
    await runLibrettoAutomation(task, sessionName)
    
    // Save session to Proof
    const proofDoc = await saveSessionToProof(sessionName, {
      title: `Task: ${task.title}`,
    })
    
    // Update task with Proof link
    await updateTaskStatus(
      task.id,
      'DONE',
      `Complete! Review session: ${proofDoc.url}`
    )
    
  } catch (error) {
    // Save failed session for debugging
    const proofDoc = await saveSessionToProof(sessionName, {
      title: `❌ Failed: ${task.title}`,
    })
    
    await updateTaskStatus(
      task.id,
      'BLOCKED',
      `Failed. Debug session: ${proofDoc.url}\nError: ${error.message}`
    )
  }
}
```

**Result:** Every task has a linked Proof document showing exactly what the bot did.

---

## Team Collaboration Workflow

### 1. Bot Runs Automation → Saves to Proof

```typescript
const proofDoc = await saveSessionToProof('patient-lookup')
// → http://localhost:4000/doc/abc123
```

### 2. Human Reviews in Browser

- Opens Proof URL
- Sees all actions + network + logs
- Adds comments: "Step 3 could be faster"

### 3. Bot Reads Comments → Optimizes

```typescript
const doc = await proof.get('abc123', accessToken)
const comments = extractComments(doc.markdown)

if (comments.includes('faster')) {
  console.log('Optimizing based on feedback...')
  // Update automation script
}
```

### 4. Iterative Improvement

- Bot runs optimized version → New Proof doc
- Human compares (v1 vs v2)
- Team decides which approach is better
- Knowledge accumulates in Proof docs

---

## Healthcare Example: EHR Integration Review

```typescript
async function checkECWIntegration() {
  const sessionName = 'ecw-integration-test'
  
  // Run full integration test
  await exec(`npx libretto open "https://eclinicalworks.com" --session ${sessionName}`)
  
  // Login
  await exec(`npx libretto exec --session ${sessionName} \
    "await page.locator('#username').fill('${process.env.ECW_USER}');\
     await page.locator('#password').fill('${process.env.ECW_PASS}');\
     await page.locator('button[type=submit]').click()"`)
  
  // Navigate through workflow
  await exec(`npx libretto exec --session ${sessionName} \
    "await page.locator('a:has-text(\"Patient Chart\")').click();\
     await page.waitForURL('**/chart/**')"`)
  
  // Extract data
  const result = await exec(`npx libretto exec --session ${sessionName} --json \
    "return {\
      patientName: await page.locator('.patient-name').textContent(),\
      dob: await page.locator('.patient-dob').textContent(),\
      mrn: await page.locator('.patient-mrn').textContent()\
    }"`)
  
  // Save to Proof for compliance review
  const proofDoc = await saveSessionToProof(sessionName, {
    title: '🏥 ECW Integration - Compliance Review',
  })
  
  // Add compliance checklist
  await proof.edit(proofDoc.slug, proofDoc.accessToken, {
    operations: [{
      type: 'insert_after',
      blockId: 'review-checklist',
      content: [{
        type: 'heading',
        level: 2,
        text: 'HIPAA Compliance Checklist',
      }, {
        type: 'bulletList',
        items: [
          '[ ] No PHI exposed in network logs?',
          '[ ] Credentials not logged?',
          '[ ] Session terminated properly?',
          '[ ] Data access logged in EHR?',
          '[ ] Automation uses service account (not personal)?',
        ],
      }],
    }],
  })
  
  // Notify compliance team
  await notifySlack({
    channel: '#compliance',
    message: `ECW integration test complete. Review needed: ${proofDoc.url}`,
  })
  
  await exec(`npx libretto close --session ${sessionName}`)
  
  return {
    result: JSON.parse(result.stdout),
    proofUrl: proofDoc.url,
  }
}
```

**Value:** Compliance team can review exactly what the automation did, verify no PHI leaks, approve for production.

---

## Proof Features for Automation

**Version Control:**
- Every edit tracked (who changed what, when)
- Compare session v1 vs v2
- Rollback to previous state

**Collaboration:**
- Multiple team members can comment
- Real-time updates
- @mentions for specific people

**Search:**
- Find all sessions for a specific portal
- Search error messages across sessions
- Discover patterns

**Access Control:**
- Share specific documents (not entire workspace)
- Time-limited access tokens
- Audit log of who viewed what

---

## Best Practices

### DO:
✅ Save failed sessions (debugging gold)
✅ Include context (why this session ran)
✅ Add review checklists (guide team attention)
✅ Link from task tracking (full audit trail)
✅ Summarize key findings (don't make team read logs)

### DON'T:
❌ Save every successful session (creates noise)
❌ Include sensitive data (passwords, PHI, tokens)
❌ Skip session cleanup (Libretto still running)
❌ Forget to notify team (docs sit unreviewed)
❌ Overwrite (create new doc per run for comparison)

---

## Troubleshooting

### Issue: Proof document too large

**Cause:** Network logs with large responses

**Solution:**
```typescript
// Filter large responses before saving
const filteredNetwork = session.network.map(req => ({
  ...req,
  response: req.response?.length > 10000
    ? `[Response too large: ${req.response.length} bytes]`
    : req.response,
}))
```

### Issue: Session data missing

**Cause:** Libretto session closed before export

**Solution:**
```typescript
// Always save BEFORE closing
await saveSessionToProof(sessionName)
await exec(`npx libretto close --session ${sessionName}`)
```

### Issue: Team can't access Proof

**Cause:** Using local Proof server

**Solution:**
```bash
# Deploy Proof to shared server
# Or use Proof Cloud (when available)
export PROOF_URL=https://proof.your-company.com
```

---

## Further Reading

- [Proof SDK Documentation](https://github.com/EveryInc/proof-sdk)
- [Libretto Documentation](https://github.com/saffron-health/libretto)
- [Task Tracking Pattern](./docs/task-tracking-pattern.md)

---

**Maintained by:** Community  
**Example by:** OpenClaw  
**License:** MIT
