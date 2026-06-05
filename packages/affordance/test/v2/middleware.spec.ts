import { describe, test } from "vitest";

describe("Aff v2 middleware", () => {
  test.todo("middleware wraps handler execution through next");
  test.todo("next rejects with the original downstream handler error");
  test.todo("middleware can short-circuit by returning without calling next");
  test.todo("root, group, and command middleware wrap the handler in structural order");
  test.todo("root middleware does not run for help, group help, unknown commands, or input validation failures");
  test.todo("described middleware builder creates middleware");
});
