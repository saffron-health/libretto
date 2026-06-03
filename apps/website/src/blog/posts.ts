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
    slug: "understanding-ai-browser-automation-tooling",
    title: "Understanding today's AI browser automation tooling",
    description:
      "A practical map of browser automation frameworks, agent browser tools, browser agents, cloud infrastructure, and agent-assisted automation.",
    publishedAt: "2026-06-03",
    readingTime: "6 min read",
    markdown: `## Understanding today's AI browser automation tooling

## Why browser automation got complicated

Browser automation used to be a pretty clear category. You wrote a script with Playwright, Selenium, or Puppeteer. The script opened a browser, clicked through a flow, and did the same thing every time you ran it.

AI agents made this more confusing. There are now a lot more tools that involve both browsers and models, but they do very different things. One might help a developer write a script, while another might run a browser in the cloud or let an agent decide what to click next.

This post is my attempt to map the landscape. Not every category is clean. A few tools overlap. But the map is still helpful because it tells you what kind of problem each tool is actually trying to solve.

## Category 1: browser automation frameworks

*Examples:* [Playwright](https://playwright.dev/), [Selenium](https://www.selenium.dev/), [Puppeteer](https://pptr.dev/), [Stagehand](https://www.stagehand.dev/).

The first category is browser automation frameworks. These are the tools people have conventionally used for web scraping, end-to-end testing, and workflow automation. You write code that opens a browser and tells it exactly what to do.

They are useful because the workflow is explicit. The code says which page to open, what to click, what to wait for, and what data to pull out. That makes the automation easier to inspect than a black-box agent run. But these scripts are also notorious for being painful to write and maintain.

Stagehand fits in this category, but it changes the feel of the code. You still write a program, but parts of that program can be natural-language actions or extraction steps. That can make authoring much faster when selectors are annoying or the page structure keeps changing.

\`\`\`typescript
// Traditional browser automation
await page.getByRole("button", { name: "Submit" }).click();

// AI-native browser automation
await stagehand.page.act("click the submit button");
\`\`\`

Its upside is also its downside. Once the code says "click the submit button," the code no longer fully explains what will happen at runtime. You get flexibility, but you give up some inspectability.

## Category 2: tools for agents to use browsers

*Examples:* [Agent Browser](https://agent-browser.io/), [Playwright MCP](https://github.com/microsoft/playwright-mcp).

The next category is tools that let your coding agent open and use a browser locally. E.g. skills, MCP servers, or CLIs that lets your agent open a browser and do some work on it. These are often available for free and open-source.

They are usually used for testing web apps locally, or running one-off flows. Some of them are also able to connect to your local Chrome instance using a Chrome extension e.g. [Claude in Chrome](https://code.claude.com/docs/en/chrome). These tools are especially useful for closing the feedback loop for agents - letting them test their own flow and see where it breaks means less work for you.

\`\`\`bash
# the agent runs this to inspect the page
agent-browser snapshot -i

# then it uses the returned refs to act on the page
agent-browser click @e2
\`\`\`

They are great for local coding work but not the right tool if you need browser automation to run in the cloud, or if you are trying to run the same workflow often.

![Agent Browser homepage showing an ASCII browser snapshot](/blog/ai-browser-automation-tooling/agent-browser.png)

## Category 3: full browser agents

A browser agent is basically an agent with access to a browser tool, with the sole purpose of performing some goal workflow on the browser and often running in the cloud.

The difference from the previous category is who owns the loop. Tools like Playwright MCP give your local coding agent browser access while it is building or debugging, giving you full control. A full browser agent is often a paid managed service from a provider.

![ChatGPT Atlas browser screenshot](/blog/ai-browser-automation-tooling/chatgpt-atlas.png)

That makes browser agents useful for workflows where the path is not fixed, like if you are booking a tennis court for example, or for one-off workflows. The tradeoff is that every run is a little live. It's slower, more expensive, less predictable, and harder to audit than a script. If you're reserving a tennis court, it's fine, but you wouldn't want to ask a browser agent to send a bank transfer for example.

## Category 4: browser cloud infra providers

Browser cloud providers are the infrastructure layer. They give you hosted browser sessions, plus the operational pieces that get annoying once a workflow leaves your laptop: persistence, logs, recordings, proxies, captcha-solving and auto-scaling.

You can host simple browser automation scripts yourself via a Chromium docker container or similar, but adding in everything that makes production browser infra is worth outsourcing to a managed service.

## Category 5: agent-assisted automation tools

This brings us to Libretto, which is trying to solve a specific gap in the map: how do you get the ease-of-use of an agent exploring a workflow, but end up with something closer to a fast, cheap, reliable automation script?

Libretto is a skill and CLI for coding agents that helps them build and maintain browser automation code. You give your coding agent access to Libretto (just tell it to "fetch and follow [https://libretto.sh/start.md](https://libretto.sh/start.md)"), then ask it for a workflow, like "open Craigslist and tell me what the first 10 entries on the lost+found page are", or record the actions you want to automate. Your agent uses Libretto to turn that exploration into fast, cheap, deterministic automation code.

With a browser agent, you pay for the model to reason through the task every time. With Libretto, you pay that cost once while the workflow is being authored. After that, the workflow can run in the cloud as normal automation, with no token cost on every run.

Libretto is best when the workflow is worth keeping around. If you only need to do something once, a browser agent is probably simpler. But if the same flow needs to run again, be debugged later, or become part of a product, it is better to have code and traces you can inspect instead of a fresh agent run and a prayer every time.

## Comparison / map

| Category | What it does | Best for | Main tradeoff |
| --- | --- | --- | --- |
| Browser automation frameworks | You write RPA code that controls the browser directly. | Known workflows where you want deterministic code. | Powerful, but painful to author and maintain. |
| Tools for agents to use browsers | Give coding agents browser context and browser controls. | Local development, debugging, and testing. | Great feedback loop, but not production automation by itself. |
| Full browser agents | Let an agent decide browser actions at runtime. | One-off or changing workflows where flexibility matters. | Slow, expensive, and harder to audit than a script. |
| Browser cloud infra providers | Host browser sessions and production browser infrastructure. | Scale, persistence, proxies, recordings, and managed sessions. | Often paid service - but worth it if this is for your business. |
| Agent-assisted automation tools | Turn browser exploration into durable, maintainable automation. | Repeated workflows that need to be maintained over time. | More setup than a live agent, but faster, cheaper and easier to inspect. |

## Conclusion

The browser tooling space is messy because, with agents, the browser is suddenly useful in a lot more ways.

Traditional RPA has always lived in this slightly niche corner of software: important for the teams that needed it, but too brittle and specialized to become part of most developers' lives. Agents are changing that. They make it feel possible to automate workflows that used to be too messy, too visual, or too annoying to turn into software.

The direction feels clear: the browser is becoming a much more powerful surface for automation than it used to be.`,
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
