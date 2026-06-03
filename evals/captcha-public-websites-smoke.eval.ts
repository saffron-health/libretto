import { WEBSITE_EVALS, registerWebsiteEvalCases } from "./public-website-benchmark.js";

const CAPTCHA_SMOKE_EVAL_NAMES = new Set([
  "google official playwright docs result",
  "reddit browser automation thread",
  "walmart paper towels search",
  "booking.com chicago hotel search",
  "doordash nyc pizza search",
]);

registerWebsiteEvalCases(
  WEBSITE_EVALS.filter((websiteEval) =>
    CAPTCHA_SMOKE_EVAL_NAMES.has(websiteEval.name),
  ),
);
