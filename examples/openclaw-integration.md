# OpenClaw Integration with Libretto

This guide shows how to use Libretto within OpenClaw for browser automation workflows.

## Overview

OpenClaw is an agent runtime that supports skills, MCP tools, and task tracking. Libretto's browser automation capabilities integrate seamlessly with OpenClaw's workflow system.

## Prerequisites

```bash
# Install OpenClaw (if not already installed)
npm install -g openclaw

# Install Libretto in your project
npm install --save-dev libretto
npx libretto init
npx libretto ai configure openai  # or anthropic/gemini/vertex
```

## Basic Usage

### Using Libretto Skill in OpenClaw

The Libretto skill works automatically in OpenClaw. Just reference it in your requests:

```
Use the Libretto skill to scrape the first 10 posts from Hacker News.
Include title, author, points, and comment count for each.
```

OpenClaw will:
1. Load the Libretto skill from `.openclaw/`
2. Execute browser automation commands
3. Return structured results

### OpenClaw MCP Tool Wrapper

For programmatic access, create an MCP tool that wraps Libretto commands:

```typescript
// tools/browser-automation.ts
import { spawn } from 'child_process'
import { promisify } from 'util'
import { exec as execCallback } from 'child_process'

const exec = promisify(execCallback)

export async function libretto_screenshot(opts: {
  url: string
  objective: string
  context: string
  session?: string
}) {
  const session = opts.session || 'default'
  
  // Open URL
  await exec(`npx libretto open "${opts.url}" --session ${session} --headless`)
  
  // Take snapshot with analysis
  const { stdout } = await exec(
    `npx libretto snapshot \
      --session ${session} \
      --objective "${opts.objective}" \
      --context "${opts.context}" \
      --json`
  )
  
  const result = JSON.parse(stdout)
  
  return {
    screenshot: result.path,
    coordMap: result.coordMap,
    analysis: result.analysis,
    desktopIndex: result.desktopIndex
  }
}

export async function libretto_execute_script(opts: {
  code: string
  session?: string
}) {
  const session = opts.session || 'default'
  
  const { stdout } = await exec(
    `npx libretto exec --session ${session} "${opts.code}"`
  )
  
  return {
    result: stdout.trim()
  }
}

export async function libretto_network_capture(opts: {
  url: string
  session?: string
}) {
  const session = opts.session || 'default'
  
  // Open URL
  await exec(`npx libretto open "${opts.url}" --session ${session} --headless`)
  
  // Wait for page load
  await exec(`npx libretto exec --session ${session} "await page.waitForLoadState('networkidle')"`)
  
  // Get network logs
  const { stdout } = await exec(
    `npx libretto network --session ${session} --json`
  )
  
  return {
    requests: JSON.parse(stdout)
  }
}
```

### Register MCP Tools

In your OpenClaw `mcp.json`:

```json
{
  "tools": [
    {
      "name": "browser_screenshot",
      "description": "Capture and analyze a webpage screenshot using Libretto",
      "function": "libretto_screenshot",
      "parameters": {
        "url": "string",
        "objective": "string",
        "context": "string",
        "session": "string (optional)"
      }
    },
    {
      "name": "browser_execute",
      "description": "Execute Playwright code in a Libretto session",
      "function": "libretto_execute_script",
      "parameters": {
        "code": "string",
        "session": "string (optional)"
      }
    },
    {
      "name": "browser_network",
      "description": "Capture network requests from a page load",
      "function": "libretto_network_capture",
      "parameters": {
        "url": "string",
        "session": "string (optional)"
      }
    }
  ]
}
```

## Task Tracking Integration

### Using TODO.md with Libretto

OpenClaw supports task tracking via `TODO.md`. Track browser automation workflows:

```markdown
# TODO.md

### @agent: Automate patient eligibility check
**Assigned:** 2026-03-23 (by @user)
**Status:** 🔄 IN PROGRESS
**Session:** availity-eligibility

**Workflow:**
1. [ ] Login to Availity portal (libretto)
2. [ ] Navigate to eligibility section
3. [ ] Enter patient DOB and insurance ID
4. [ ] Extract eligibility status
5. [ ] Return structured result

**Progress:**
- Opened session: availity-eligibility
- Login successful
- Currently on step 3
```

The agent updates status as it executes Libretto commands, providing full audit trail.

### Proof Integration (Collaborative Debugging)

Save Libretto sessions to Proof for team collaboration:

```typescript
import { ProofClient } from '@proof-sdk/client'

async function trackLibrettoSession(sessionName: string) {
  const proof = new ProofClient('http://localhost:4000')
  
  // Get Libretto session logs
  const { stdout: logs } = await exec(
    `cat .libretto/sessions/${sessionName}/logs.jsonl`
  )
  
  const { stdout: network } = await exec(
    `npx libretto network --session ${sessionName} --json`
  )
  
  // Create Proof document
  const markdown = `
# Libretto Session: ${sessionName}

## Network Requests
\`\`\`json
${network}
\`\`\`

## Session Logs
\`\`\`
${logs}
\`\`\`

**Status:** Ready for review
  `.trim()
  
  const doc = await proof.create({
    markdown,
    source: 'libretto-automation',
    metadata: {
      session: sessionName,
      timestamp: new Date().toISOString()
    }
  })
  
  console.log(`Session tracked: ${doc.url}`)
  return doc
}

// Use in workflow
await libretto_screenshot({ url: '...', objective: '...', context: '...' })
await trackLibrettoSession('default')
```

Team members can then view the session in Proof browser, add annotations, and collaborate on debugging.

## Example Workflows

### Healthcare Portal Automation

```typescript
// Availity eligibility check workflow
async function checkEligibility(patient: {
  firstName: string
  lastName: string
  dob: string
  insuranceId: string
}) {
  const session = 'availity-check'
  
  // 1. Open portal
  await exec(`npx libretto open "https://apps.availity.com" --session ${session}`)
  
  // 2. Login (using saved profile)
  await exec(`npx libretto exec --session ${session} \
    "await page.locator('#username').fill('${process.env.AVAILITY_USER}');\
     await page.locator('#password').fill('${process.env.AVAILITY_PASS}');\
     await page.locator('button[type=submit]').click();\
     await page.waitForURL('**/dashboard')"`)
  
  // 3. Navigate to eligibility
  await exec(`npx libretto exec --session ${session} \
    "await page.locator('a:has-text(\"Eligibility\")').click()"`)
  
  // 4. Fill patient info
  await exec(`npx libretto exec --session ${session} \
    "await page.locator('#firstName').fill('${patient.firstName}');\
     await page.locator('#lastName').fill('${patient.lastName}');\
     await page.locator('#dob').fill('${patient.dob}');\
     await page.locator('#insuranceId').fill('${patient.insuranceId}');\
     await page.locator('button:has-text(\"Check Eligibility\")').click()"`)
  
  // 5. Extract result
  const { stdout } = await exec(`npx libretto exec --session ${session} --json \
    "return { \
      status: await page.locator('.eligibility-status').textContent(),\
      coverage: await page.locator('.coverage-details').textContent(),\
      effectiveDate: await page.locator('.effective-date').textContent()\
    }"`)
  
  const result = JSON.parse(stdout)
  
  // 6. Close session
  await exec(`npx libretto close --session ${session}`)
  
  return result
}
```

### Convert UI Automation to API Calls

```typescript
// Use Libretto to reverse-engineer API
async function discoverAPI(url: string) {
  const session = 'api-discovery'
  
  // 1. Open page with network capture
  await exec(`npx libretto open "${url}" --session ${session} --headless`)
  
  // 2. Perform UI actions
  await exec(`npx libretto exec --session ${session} \
    "await page.locator('button.search').click();\
     await page.waitForResponse(resp => resp.url().includes('/api/'))"`)
  
  // 3. Capture network requests
  const { stdout: network } = await exec(
    `npx libretto network --session ${session} --json`
  )
  
  const requests = JSON.parse(network)
  
  // 4. Filter for API calls
  const apiCalls = requests.filter(r => 
    r.url.includes('/api/') && r.method !== 'GET'
  )
  
  // 5. Generate direct API client
  const apiClient = apiCalls.map(call => `
// ${call.method} ${call.url}
async function ${call.url.split('/').pop()}(data: any) {
  return fetch('${call.url}', {
    method: '${call.method}',
    headers: ${JSON.stringify(call.requestHeaders, null, 2)},
    body: JSON.stringify(data)
  })
}
  `).join('\n\n')
  
  return {
    apiCalls,
    generatedClient: apiClient
  }
}
```

## Best Practices

### Session Management

- **Use named sessions** for different workflows
- **Save profiles** for authenticated sites (`npx libretto save <domain>`)
- **Clean up sessions** after workflows complete
- **Monitor session state** in `.libretto/sessions/`

### Error Handling

```typescript
async function robustLibrettoCall(command: string, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const { stdout } = await exec(command)
      return stdout
    } catch (error) {
      if (i === maxRetries - 1) throw error
      
      // Take snapshot on error
      await exec(`npx libretto snapshot \
        --objective "Diagnose error" \
        --context "Command failed: ${command}"`)
      
      console.log(`Retry ${i + 1}/${maxRetries}`)
      await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)))
    }
  }
}
```

### Performance

- **Use headless mode** for production (`--headless`)
- **Reuse sessions** for multiple operations
- **Cache auth profiles** with `npx libretto save`
- **Convert to API calls** when possible (faster than UI automation)

## Troubleshooting

### Common Issues

**Issue:** "Selector not found"
```bash
# Use snapshot to debug
npx libretto snapshot \
  --objective "Find the submit button" \
  --context "I'm trying to click the submit button but getting selector not found"
```

**Issue:** "Session already exists"
```bash
# Close existing session
npx libretto close --session <name>

# Or use different session name
npx libretto open <url> --session <unique-name>
```

**Issue:** "Authentication required"
```bash
# Use headed mode for manual login
npx libretto open <url> --session <name> --headed

# Then save the authenticated session
npx libretto save <domain> --session <name>

# Future runs will reuse auth
```

## Resources

- [Libretto Documentation](https://github.com/saffron-health/libretto)
- [OpenClaw Documentation](https://openclaw.ai/docs)
- [MCP Tool Spec](https://modelcontextprotocol.io)
- [Proof SDK](https://github.com/EveryInc/proof-sdk)

## Community

Have questions or built something cool? Share in:
- [Libretto Discussions](https://github.com/saffron-health/libretto/discussions)
- [OpenClaw Community](https://discord.gg/openclaw)

---

**Example by:** OpenClaw community  
**License:** MIT (same as Libretto)
