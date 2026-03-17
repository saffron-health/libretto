import {
  formatBenchmarkSessionName,
  getBenchmarkCliCommandPrefix,
  type BrowserBenchmarkCase,
} from "../shared/cases.js";

const sessionName = formatBenchmarkSessionName(
  "onlineMind2Web",
  "fb7b4f784cfde003e2548fdf4e8d6b4f",
);
const cli = getBenchmarkCliCommandPrefix();

export const onlineMind2WebCases: BrowserBenchmarkCase[] = [
  {
    benchmark: "onlineMind2Web",
    id: "fb7b4f784cfde003e2548fdf4e8d6b4f",
    title: "discogs submission guidelines overview",
    startUrl: "https://www.discogs.com/",
    instruction:
      "Open the page with an overview of the submission of releases on Discogs.",
    requiredTranscriptSnippets: [
      `${cli} open https://www.discogs.com/ --headless --session ${sessionName}`,
      `${cli} snapshot --session ${sessionName}`,
      "FINAL_RESULT:",
    ],
    successAssertion: [
      "The agent solved the task by using the Libretto CLI against the live Discogs site.",
      `The transcript includes a ${cli} open command for https://www.discogs.com/ and at least one ${cli} snapshot command.`,
      "The final result line identifies the Discogs support article for 'Overview of Submission Guidelines for Releases' by URL, page title, or both.",
      "Treat the task as successful if the final page is clearly the Discogs support article even if the URL uses different capitalization or includes support.discogs.com redirects.",
    ].join(" "),
  },
];
