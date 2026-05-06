import { evalCase } from "./eval-case.js";
import { recordScore } from "./scoring.js";

evalCase(
  { name: "hookup smoke trivial agent and scorer" },
  async ({ harness }) => {
    const response = await harness.send(
      "Reply with exactly this line and nothing else: FINAL_RESULT: pineapple",
    );

    const score = await response.score([
      'The assistant replied with the exact line "FINAL_RESULT: pineapple".',
    ]);
    recordScore("hookup smoke scorer", score);
  },
);
