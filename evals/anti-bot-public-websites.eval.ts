import {
  ANTI_BOT_CLEAN_WEBSITE_EVAL_NAMES,
  WEBSITE_EVALS,
  registerWebsiteEvalCases,
} from "./public-website-benchmark.js";

registerWebsiteEvalCases(
  WEBSITE_EVALS.filter((websiteEval) =>
    ANTI_BOT_CLEAN_WEBSITE_EVAL_NAMES.has(websiteEval.name),
  ),
);
