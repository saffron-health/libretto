import { evalCase } from "./eval-case.js";
import type { EvalScore } from "./harness.js";
import { recordScore, type InfraClassification } from "./scoring.js";

type WebsiteEval = {
  name: string;
  task: string;
};

const WEBSITE_EVALS: WebsiteEval[] = [
  {
    name: "craigslist used bikes search",
    task: "Search Craigslist for used bikes in San Francisco. Tell me the title and price of the first relevant listing.",
  },
  {
    name: "apartments.com austin apartment search",
    task: "Search Apartments.com for apartments in Austin under $2,000. Tell me the first listing name, price, and neighborhood.",
  },
  {
    name: "apple newest iphone lookup",
    task: "Find the newest iPhone on Apple.com. Tell me its starting price and available colors.",
  },
  {
    name: "google official playwright docs result",
    task: 'Search Google for "Playwright docs network mocking". Open the official docs result and tell me the page title.',
  },
  {
    name: "youtube playwright tutorial search",
    task: 'Search YouTube for "Playwright tutorial". Tell me the title of the first video result.',
  },
  {
    name: "reddit browser automation thread",
    task: 'Search Reddit for "browser automation". Open one relevant thread and summarize the top comment.',
  },
  {
    name: "amazon wireless mouse search",
    task: 'Search Amazon for "wireless mouse". Tell me the name and price of the first organic result.',
  },
  {
    name: "walmart paper towels search",
    task: 'Search Walmart for "paper towels". Tell me the first product name, price, and whether pickup is available.',
  },
  {
    name: "target coffee maker search",
    task: 'Search Target for "coffee maker". Tell me the first product name, price, and rating.',
  },
  {
    name: "best buy headphones search",
    task: 'Search Best Buy for "noise cancelling headphones". Tell me the first product name and price.',
  },
  {
    name: "airbnb austin next weekend search",
    task: "Search Airbnb for stays in Austin next weekend. Tell me the first listing name and nightly price.",
  },
  {
    name: "booking.com chicago hotel search",
    task: "Search Booking.com for hotels in Chicago next weekend. Tell me the first hotel name, rating, and price.",
  },
  {
    name: "expedia sfo jfk flight search",
    task: "Search Expedia for flights from SFO to JFK next Friday. Tell me the cheapest listed price.",
  },
  {
    name: "doordash nyc pizza search",
    task: "Search DoorDash for pizza near New York City. Tell me the first restaurant name and rating.",
  },
  {
    name: "uber eats sf sushi search",
    task: "Search Uber Eats for sushi near San Francisco. Tell me the first restaurant name and delivery estimate.",
  },
  {
    name: "zillow seattle homes search",
    task: "Search Zillow for homes in Seattle under $800k. Tell me the first listing price and address area.",
  },
  {
    name: "realtor.com denver homes search",
    task: "Search Realtor.com for homes in Denver. Tell me the first listing price and number of bedrooms.",
  },
  {
    name: "yelp brooklyn coffee shops search",
    task: "Search Yelp for coffee shops in Brooklyn. Tell me the first business name, rating, and review count.",
  },
  {
    name: "linkedin public job search",
    task: 'Search LinkedIn for "browser automation engineer". Tell me if public results are visible without signing in.',
  },
  {
    name: "hacker news browser automation search",
    task: 'Search Hacker News for "browser automation". Find one recent thread and tell me its title.',
  },
  {
    name: "github playwright repo stats",
    task: "Open the Playwright GitHub repo. Tell me how many stars it has and what language it mostly uses.",
  },
  {
    name: "npm playwright package lookup",
    task: "Look up the playwright package on npm. Tell me the latest version and weekly downloads.",
  },
  {
    name: "pypi requests package lookup",
    task: "Look up the requests package on PyPI. Tell me the latest version and supported Python versions.",
  },
  {
    name: "mdn array map lookup",
    task: "Find the MDN page for Array.prototype.map(). Tell me what the method returns.",
  },
  {
    name: "wikipedia olympics medal table lookup",
    task: "Open the Wikipedia page for the 2024 Summer Olympics medal table. Tell me the top three countries.",
  },
  {
    name: "books to scrape five star cheapest book",
    task: "Find the cheapest book with a 5-star rating on Books to Scrape. Tell me its title and price.",
  },
  {
    name: "quotes to scrape einstein quote",
    task: "Go through Quotes to Scrape and find the first quote by Albert Einstein. Tell me the quote.",
  },
];

const LIVE_PAGE_EVIDENCE_CRITERION =
  "The agent used Libretto with the configured browser provider to reach the requested website or task area, perform the requested search or lookup, and return a plausible answer grounded in live page evidence. Be lenient about ambiguous result choice, sorting, availability, prices, or dynamic website content. Mark false if the run failed to use Libretto, used a different browser provider than the configured one, went to the wrong site/task area, could not access the relevant page due to browser/provider issues, or returned an answer without evidence from the live page.";
const ANTI_BOT_CRITERION =
  "Mark false if the run encountered or reported an anti-bot block, including CAPTCHA, challenge, human verification, bot check, Access Denied, permission denied, blocked, 403/Forbidden, unusual traffic, or bot-detection pages, and the block was still present after the agent waited up to 3 minutes and checked the same intended site again. Mark false if the agent worked around an anti-bot block by opening another page, session, search result, mirror, API, cached copy, or fallback source. Mark true for a challenge if the configured browser provider visibly solved it automatically within the 3-minute wait and the agent continued directly on the intended site from that solved page.";

function infraClassificationForScore(
  score: EvalScore,
): InfraClassification {
  const antiBotCriterion = score.criteria[1];
  if (antiBotCriterion && !antiBotCriterion.pass) return "anti-bot-failure";
  return score.passed === score.total ? "clean-pass" : "ordinary-failure";
}

function captchaInstruction(provider: string): string {
  const providerName =
    provider === "kernel"
      ? "Kernel"
      : provider === "browserbase"
        ? "browserbase"
        : provider === "steel"
          ? "Steel"
          : "local";
  const otherProviders = ["local", "Kernel", "browserbase", "Steel"]
    .filter((name) => name !== providerName)
    .join(", ");

  if (provider === "kernel") {
    return [
      `Use the configured Kernel browser provider; do not switch to ${otherProviders}, search-result snippets, mirrors, APIs, or unrelated fallback sources.`,
      "The browser provider is Kernel, which is expected to auto-solve CAPTCHA, challenge, bot-check, and human-verification pages.",
      "If you see a CAPTCHA, challenge, bot-check, human-verification page, Access Denied, permission denied, blocked, 403/Forbidden, unusual traffic, or bot-detection page, wait up to 3 minutes for the browser provider to solve it automatically, then check the same intended site again.",
      "If the anti-bot page is gone, continue directly from the requested site. If the anti-bot page is still there after the 3-minute wait, report that the task failed immediately.",
      "Do not work around anti-bot blocks by opening another page, session, search result, mirror, API, cached copy, or fallback source.",
    ].join(" ");
  }

  return [
    `Use the configured ${providerName} browser provider; do not switch to ${otherProviders}, search-result snippets, mirrors, APIs, or unrelated fallback sources.`,
    `If you see a CAPTCHA, challenge, bot-check, human-verification page, Access Denied, permission denied, blocked, 403/Forbidden, unusual traffic, or bot-detection page, wait up to 3 minutes for the browser provider to solve it automatically, then check the same intended site again.`,
    "If the anti-bot page is gone, continue directly from the requested site. If the anti-bot page is still there after the 3-minute wait, report that the task failed immediately.",
    "Do not work around anti-bot blocks by opening another page, session, search result, mirror, API, cached copy, or fallback source.",
  ].join(" ");
}

for (const websiteEval of WEBSITE_EVALS) {
  evalCase({ name: websiteEval.name }, async ({ harness }) => {
    const response = await harness.send(
      `${websiteEval.task}. Use Libretto. ${captchaInstruction(
        harness.browserProvider,
      )}`,
    );

    const score = await response.score([
      LIVE_PAGE_EVIDENCE_CRITERION,
      ANTI_BOT_CRITERION,
    ]);
    recordScore(websiteEval.name, score, {
      infraClassification: infraClassificationForScore(score),
    });
  });
}
