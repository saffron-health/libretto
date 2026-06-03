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
    slug: "what-we-learned-building-healthcare-integrations",
    title: "What we learned building healthcare integrations for a year",
    description:
      "Why we moved from runtime browser agents to development-time AI, Playwright scripts, and direct network calls.",
    publishedAt: "2026-05-14",
    readingTime: "3 min read",
    markdown: String.raw`# What we learned building healthcare integrations for a year

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
