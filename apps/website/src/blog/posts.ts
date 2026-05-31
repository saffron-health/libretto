import { mdxParse } from "safe-mdx/parse";

type BlogPostInput = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  readingTime: string;
  markdown: string;
};

export type BlogPost = BlogPostInput & {
  mdast: ReturnType<typeof mdxParse>;
};

function createBlogPost(post: BlogPostInput): BlogPost {
  return {
    ...post,
    mdast: mdxParse(post.markdown),
  };
}

export const BLOG_POSTS = [
  createBlogPost({
    slug: "deterministic-browser-automation-why-it-matters",
    title: "Deterministic Browser Automation: Why It Matters",
    description:
      "Deterministic browser automation ensures predictable, auditable workflows for regulated industries where non-deterministic agents create compliance risk.",
    publishedAt: "2026-05-31",
    readingTime: "6 min read",
    markdown: String.raw`# Deterministic Browser Automation: Why It Matters

Deterministic browser automation ensures predictable, auditable workflows for regulated industries where non-deterministic agents create compliance risk. Unlike traditional automation tools that rely on unpredictable DOM parsing or runtime decision-making, deterministic approaches guarantee consistent behavior across executions. Healthcare and financial automation companies require this level of certainty because flaky automation creates liability and regulatory failures.

**Quick Answer (40-60 words):** Deterministic browser automation guarantees identical behavior across script executions through predictable selectors, fixed wait strategies, and reproducible workflows. Essential for healthcare, finance, and compliance applications where audit trails and consistent outcomes matter more than adaptive flexibility.

## What is deterministic browser automation?

Deterministic browser automation refers to web automation scripts that produce identical results when run multiple times against the same target environment. Every action, selector, and timing decision follows predefined logic rather than runtime adaptation. The automation behaves predictably: same inputs produce same outputs, same page states trigger same responses.

Traditional browser automation often incorporates non-deterministic elements. AI-driven tools like Browser Use make runtime decisions based on page analysis. These decisions can vary between executions even when facing identical page states. Deterministic automation eliminates this variability by pre-defining every interaction pattern and fallback strategy.

## How do deterministic and non-deterministic approaches differ?

Non-deterministic automation adapts to page changes through runtime intelligence. AI agents analyze DOM structures, make decisions about which elements to interact with, and adjust their behavior based on visual or structural cues. This flexibility helps handle dynamic websites but introduces unpredictability.

Deterministic automation follows explicit scripts with predefined interaction patterns. Every selector, wait condition, and error handling strategy gets defined during development rather than discovered during execution.

| Aspect | Deterministic | Non-deterministic |
|--------|---------------|-------------------|
| **Execution Consistency** | Identical behavior per run | Variable behavior per run |
| **Error Handling** | Predefined fallback paths | Runtime decision-making |
| **Debugging** | Reproducible failures | Context-dependent failures |
| **Compliance** | Full audit trail | Partial audit trail |
| **Development Time** | Higher upfront cost | Lower upfront cost |
| **Runtime Performance** | Faster execution | Slower execution |

According to [Browserbase](https://www.browserbase.com/blog/browser-agent-autonomy-levels), Playwright and Puppeteer represented the state of the art in 2022 as deterministic automation tools that "worked well until the web inevitably changed."

## Why do regulated workflows demand determinism?

Regulated industries require complete audit trails and predictable behavior patterns. Healthcare automation must demonstrate exactly which actions occurred during patient data processing. Financial automation needs reproducible workflows for compliance reporting and risk management.

Non-deterministic agents introduce uncertainty into these processes. When an AI agent makes a runtime decision about which patient record to access or which form field to populate, that decision becomes difficult to audit or reproduce. Regulatory bodies require documentation showing exactly how automated systems behave under specific conditions.

Deterministic automation provides this documentation through explicit script definitions. Every conditional branch, timing decision, and error response gets documented in code rather than discovered through runtime analysis. This creates the paper trail regulatory frameworks demand.

## Where do Playwright and Puppeteer fit in modern automation?

[Browserbase research](https://www.browserbase.com/blog/browser-agent-autonomy-levels) indicates Playwright and Puppeteer established deterministic automation as the foundation layer for web interactions. These tools provide reliable primitives: predictable selectors, consistent wait strategies, and reproducible page interactions.

Modern agent frameworks often build on top of these deterministic foundations. [Browser Use success rates](https://www.firecrawl.dev/blog/best-browser-agents) increased from ~30% to ~80% when switching from fully autonomous to a plan-follower model with human oversight. This hybrid approach combines deterministic execution with bounded AI decision-making.

Libretto extends this philosophy by providing deterministic browser automation specifically designed for agent consumption. Rather than replacing Playwright, Libretto builds agent-friendly debugging and workflow capture on top of proven deterministic foundations.

## What performance and cost trade-offs should you expect?

Deterministic automation typically offers better performance characteristics than runtime AI approaches. [Workflow Use reports](https://news.ycombinator.com/item?id=44007065) scripts run "reliably, 10x faster, and ~90% cheaper than Browser Use" when using predetermined interaction patterns instead of runtime decision-making.

[Agent-browser performance data](https://agent-browser.dev) shows text output uses ~200-400 tokens compared to ~3000-5000 tokens for full DOM output. Deterministic automation achieves similar efficiency gains by avoiding repeated page analysis and decision-making overhead.

The trade-off involves higher development-time investment. Deterministic scripts require explicit definition of interaction patterns, error handling paths, and edge case responses. Runtime AI approaches shift this complexity from development-time to execution-time, but at the cost of unpredictability and higher computational overhead.

## Which industries benefit most from deterministic automation?

Healthcare automation companies see the highest value from deterministic approaches. Electronic Health Record integrations require consistent data extraction patterns and reliable audit trails. Patient data processing cannot tolerate non-deterministic behavior that might access wrong records or misinterpret critical information.

Financial services automation faces similar requirements. Tax preparation automation, insurance claim processing, and compliance reporting all demand reproducible workflows. Libretto's deterministic approach ensures these workflows behave predictably across regulatory audits and compliance reviews.

Manufacturing and logistics companies increasingly adopt deterministic automation for supply chain integrations. These workflows often integrate with legacy systems that demand consistent interaction patterns and reliable data exchange protocols.`,
  }),
  createBlogPost({
    slug: "agent-friendly-debugging-browser-automation",
    title: "Agent-Friendly Debugging: Why Browser Automation Tools Need AI-Ready Output",
    description:
      "Standard debugging output isn't structured for AI consumption. Learn why QA teams need debugging tools designed for agent workflows and autonomous test development.",
    publishedAt: "2026-05-30",
    readingTime: "5 min read",
    markdown: String.raw`# Agent-Friendly Debugging: Why Browser Automation Tools Need AI-Ready Output

Standard debugging output from traditional browser automation tools wasn't designed for AI consumption. Playwright logs, Chrome DevTools output, and conventional error messages require human interpretation. QA teams building autonomous test workflows need debugging information structured for agent consumption rather than manual review.

**Quick Answer (40-60 words):** Agent-friendly debugging provides structured, machine-readable output that AI agents can interpret without human intervention. Essential for autonomous test development, workflow generation, and production debugging where agents need to understand failures and generate fixes independently.

## What makes debugging output "agent-friendly"?

Agent-friendly debugging output follows structured formats that AI systems can parse and act upon programmatically. Rather than human-readable error messages, these tools provide JSON payloads, structured logs, and machine-interpretable state descriptions.

Traditional debugging tools optimize for human consumption. Playwright generates verbose console output with stack traces formatted for developer reading. Chrome DevTools presents visual information designed for manual analysis. These formats require human interpretation to understand what went wrong and how to fix it.

Agent-friendly debugging transforms this information into structured data. Error states become JSON objects. Page state gets serialized into parseable formats. Network failures include programmatic retry instructions rather than human-readable descriptions.

## How does traditional debugging fall short for AI agents?

Traditional debugging assumes human developers will interpret output and make decisions about fixes. Error messages use natural language descriptions. Stack traces point to code lines developers can examine manually. Browser state gets presented visually through developer tools interfaces.

AI agents cannot effectively consume this information. Natural language error messages require interpretation. Visual debugging interfaces cannot be parsed programmatically. Stack traces lack the structured context agents need to generate automated fixes.

Consider a typical Playwright timeout error: "Timeout 30000ms exceeded. Locator: text=Submit". This tells a human developer that an element wasn't found, but provides minimal context for an agent to understand the page state, why the element wasn't available, or what alternative selectors might work.

## What should agent-friendly debugging include?

Effective agent-friendly debugging provides multiple layers of structured information. Page state snapshots capture DOM structure, element availability, and timing information in machine-readable formats. Error contexts include alternative selector suggestions and retry strategies.

Network debugging becomes particularly important for agent workflows. Rather than showing HTTP status codes and response headers in human-readable formats, agent-friendly tools provide structured request/response data that agents can analyze to understand API failures and generate network-based alternatives to browser automation.

Libretto's debugging architecture exemplifies this approach. When automation fails, the system captures structured page state, provides alternative interaction strategies, and formats errors as actionable JSON rather than human-readable messages.

## Why do autonomous test workflows need structured debugging?

Autonomous test development requires agents to understand failures and generate fixes without human intervention. Traditional debugging creates a dependency on human interpretation that breaks autonomous workflows.

When an automated test fails in production, agent-friendly debugging enables the AI system to analyze the failure, understand the root cause, and either retry with different parameters or generate a fix for human review. This reduces the manual intervention required to maintain automation scripts.

QA teams using autonomous agents for test generation see particular benefits. Rather than having agents generate tests that require manual debugging when they fail, agent-friendly debugging enables the AI to iterate on test logic autonomously until scripts achieve reliability.

## Which debugging patterns work best for agents?

Structured error responses perform better than natural language descriptions. JSON error objects with standardized fields enable agents to programmatically understand failure modes and generate appropriate responses.

State snapshots prove more valuable than visual debugging interfaces. Serialized DOM state, element availability maps, and timing information provide the context agents need to understand page conditions and generate alternative strategies.

Network debugging requires particular attention to format. Raw HTTP logs help agents reverse-engineer APIs and build network-based alternatives to UI automation. This debugging information should be structured for programmatic analysis rather than human review.

## Where does Libretto fit in the agent debugging landscape?

Libretto bridges traditional browser automation and agent-friendly debugging by providing structured output designed for AI consumption. Rather than replacing existing debugging tools, Libretto translates their output into formats agents can interpret and act upon.

The system provides JSON-structured error responses, serialized page state, and programmatic retry suggestions. When automation fails, agents receive enough structured context to understand the failure and either retry with modifications or generate fix suggestions.

This approach enables autonomous debugging workflows where agents can identify failures, understand root causes, and generate fixes without requiring human interpretation of traditional debugging output.`,
  }),
  createBlogPost({
    slug: "browser-automation-for-ai-agents",
    title: "Browser Automation for AI Agents: Building Reliable Autonomous Workflows",
    description:
      "AI agents need specialized browser automation tools for deterministic, repeatable execution. Compare approaches and learn what makes automation truly agent-ready.",
    publishedAt: "2026-05-29",
    readingTime: "7 min read",
    markdown: String.raw`# Browser Automation for AI Agents: Building Reliable Autonomous Workflows

AI agents need specialized browser automation capabilities that traditional tools weren't designed to provide. Standard browser automation focuses on human-driven development workflows, while agent-ready automation must handle autonomous execution, structured debugging, and deterministic behavior across repeated runs.

**Quick Answer (40-60 words):** Agent-ready browser automation provides deterministic execution, structured debugging output, and programmatic error handling that AI systems can interpret without human intervention. Essential for autonomous workflows where agents generate, execute, and maintain browser scripts independently.

## What makes automation "AI-agent-ready"?

Agent-ready automation differs from traditional browser automation in fundamental ways. Standard tools like Playwright assume human developers will write scripts, debug failures, and maintain automation over time. Agent-ready tools enable AI systems to perform these tasks autonomously.

Deterministic execution becomes crucial for agent workflows. When an AI generates an automation script, that script must behave predictably across multiple executions. Non-deterministic elements like runtime decision-making or adaptive selectors create unpredictability that agents struggle to manage.

Structured debugging output enables autonomous error handling. Rather than human-readable error messages, agent-ready tools provide JSON responses with programmatic retry instructions. This structured information allows agents to understand failures and generate fixes without human interpretation.

## How do different automation approaches compare for agent use?

Traditional browser automation tools optimize for human development workflows. Selenium WebDriver provides low-level browser control but requires extensive manual configuration. Playwright offers higher-level APIs but still assumes human developers will handle edge cases and debugging.

Agent frameworks attempt to bridge this gap with varying approaches. Some tools add AI decision-making on top of existing automation frameworks. Others build agent-specific interfaces while maintaining deterministic execution underneath.

| Tool Category | Deterministic Execution | Structured Debugging | Agent Integration | Best For |
|---------------|------------------------|---------------------|-------------------|----------|
| **Traditional (Playwright)** | Yes | No | Manual | Human-driven development |
| **AI Agents (Browser Use)** | No | Partial | Native | Exploratory workflows |
| **Hybrid (Libretto)** | Yes | Yes | Native | Production agent workflows |
| **Headless Browsers** | Yes | No | Manual | API integration |

Research from [Firecrawl](https://www.firecrawl.dev/blog/best-browser-agents) shows Browser Use success rates jumping "from ~30% to ~80% when switching from fully autonomous to a plan-follower model with human oversight." This improvement comes from combining deterministic execution with bounded AI decision-making.

## Why do traditional tools fail with autonomous agents?

Traditional automation tools create dependencies on human intervention that break autonomous workflows. When Playwright scripts fail, developers manually analyze error messages, inspect page state, and modify selectors or timing logic.

Autonomous agents cannot replicate this debugging process with traditional tools. Natural language error messages require interpretation. Visual debugging interfaces cannot be parsed programmatically. Stack traces lack the structured context agents need to generate fixes.

Performance characteristics also create problems for agent workflows. Traditional debugging assumes developers will manually optimize scripts for speed and reliability. Agents need automation that performs consistently without manual tuning or optimization.

## What unique capabilities do agents need?

Agents require programmatic access to page state and interaction alternatives. When an automation action fails, the agent needs structured information about page conditions, alternative selectors, and retry strategies.

Network-level debugging becomes particularly valuable for agent workflows. Agents can often replace unreliable UI automation with direct API calls when they understand the underlying network requests. This requires debugging tools that capture and structure network traffic for programmatic analysis.

Autonomous script generation demands different development patterns. Rather than writing scripts manually, agents need to observe workflows, capture interaction patterns, and generate automation code. This workflow requires tools designed for programmatic script generation rather than manual development.

## Where do runtime AI and deterministic approaches fit?

Runtime AI excels at exploratory workflows where flexibility matters more than predictability. Browser Use and similar tools handle dynamic websites effectively by making real-time decisions about page interactions.

Deterministic approaches work better for production workflows where reliability and auditability matter. Healthcare automation, financial workflows, and compliance-heavy processes require predictable behavior and complete audit trails.

The most effective agent automation combines both approaches strategically. [Workflow Use demonstrates](https://news.ycombinator.com/item?id=44007065) that deterministic scripts can run "reliably, 10x faster, and ~90% cheaper than Browser Use" when interaction patterns are well-defined.

Libretto implements this hybrid approach by providing deterministic execution with agent-friendly debugging. Agents can generate reliable scripts while maintaining the ability to adapt when underlying websites change.

## How should teams migrate to agent-ready automation?

Migration strategies depend on existing automation maturity and team structure. Teams with extensive Playwright automation can often layer agent-friendly debugging on top of existing scripts without rewriting core automation logic.

Teams starting fresh should prioritize agent integration from the beginning. Building automation with agent consumption in mind creates better long-term maintainability than retrofitting human-focused tools for agent use.

The migration process typically involves three phases: assessment of existing automation requirements, pilot projects with agent-ready tools, and gradual replacement of human-dependent workflows with autonomous alternatives.`,
  }),
  createBlogPost({
    slug: "what-we-learned-building-healthcare-integrations",
    title: "What we learned building healthcare integrations for a year",
    description:
      "Why we moved from runtime browser agents to development-time AI, Playwright scripts, and direct network calls.",
    publishedAt: "2026-05-14",
    readingTime: "3 min read",
    markdown: String.raw`## What we learned building healthcare integrations for a year

We spent the past year building and maintaining browser automations for EHR and payor portal integrations at our healthcare startup. The APIs we needed either didn't exist, were missing critical functionality, or were locked behind expensive and slow vendor processes. So, like every other healthcare startup, we leaned on browser automation. Building these automations and debugging failed ones was incredibly time-consuming, and most of what we believed going in turned out to be wrong.

The biggest shift in our thinking was moving from run-time AI (agents making decisions live on running scripts) to development-time AI (using coding agents to generate and iterate on Playwright scripts, and to debug them when they break). Everything else we figured out came after that.

## Why runtime browser agents didn't work for us

We started where most people start: fully AI-driven browser agents. It was the lowest implementation lift and seemed like the most robust approach, since if the agent could see the page it should be able to adapt to anything. Then we tried Stagehand, which looked like the right tradeoff: deterministic Playwright underneath, AI on top to handle the messy parts.

Neither held up. Four problems kept coming back:

1. **DOM parsing was unreliable on the websites we cared about.** Tools like Browser Use and Stagehand lean on the accessibility tree or custom DOM parsing to figure out what to click. That works fine on modern, well-built sites. It doesn't work on Athena, on older EHRs, or on most payor portals. Using a site's internal network calls turned out to be faster and more reliable wherever it was feasible.
2. **They got expensive fast.** Every action needed an LLM call, and for workflows with complicated branching logic you can't always rely on caching prior actions to keep things cheap and consistent.
3. **Runtime behavior wasn't interpretable.** You kind of hope you prompted the agent correctly. Legacy healthcare workflows are unintuitive and inconsistent across sites, so you can't trust an agent to just figure them out live, especially on a production patient chart.
4. **They didn't help us generate new automations or debug existing ones.** Once a script broke in production, we were on our own.

## What was actually breaking in production

After enough postmortems, our failures almost always fell into three buckets:

- **Nondeterministic popups.** Modals that appeared sometimes, usually unrelated to the flow we cared about.
- **Things on screen rendering extremely slowly.** Elements that took unpredictable amounts of time to appear, where naive waits would either time out or pass too early.
- **Edge cases with internal logic we hadn't anticipated.** Duplicate patients with no clear way to know which chart to access, mismatched referrals, etc. Stuff we absolutely did not want an AI resolving on its own.

None of these are problems a runtime agent is going to fix reliably. Popups are solvable with a lightweight detector. Slow rendering is solvable with smarter waits and retries. And the edge cases are the cases where you *want* a human in the loop, because the right resolution depends on context the agent doesn't have.

## Where we landed

We rewrote almost everything around a different philosophy: AI at development time, not runtime. The approach that worked:

- **Generate Playwright scripts ahead of time with a coding agent**, instead of having an agent drive the browser live. We use Claude Code to step through workflows ourselves, leave comments, then have the agent connect to the running script to inspect logs and network requests as it writes the automation. You get a real script you can read and modify rather than opaque agent behavior.
- **Mix Playwright UI automation with direct network/API calls in the same script.** Where it made sense, we rebuilt integrations as direct API calls: faster, more reliable, easier to maintain. Some sites have anti-bot setups that force you to drive the UI, so we ended up with a hybrid: Playwright for UI, network calls where feasible, both living in the same script.
- **Use runtime AI only in narrow, bounded places where the worst case is a retry.** Our popup detector, for example, takes a screenshot, uses coordinates to dismiss whatever appeared, and retries the original action. Runtime AI is fine when the worst case is a retry, but not when the agent is making decisions you can't anticipate or review.
- **When something breaks in production, have the agent help debug by sending a PR back to the repo**, not by making a live decision on real data.

This is what eventually became [Libretto](https://libretto.sh), the Skill + CLI we built internally and have since open-sourced. If you're building web automations, give it a try!`,
  }),
] satisfies BlogPost[];

export function getBlogPost(slug: string): BlogPost | undefined {
  return BLOG_POSTS.find((post) => post.slug === slug);
}
