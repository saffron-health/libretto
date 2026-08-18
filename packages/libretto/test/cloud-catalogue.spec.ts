import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { test } from "./fixtures";

const bookmarkId = "c0908bc8-02f0-40e7-a96a-a22e8ac3333e";
const unavailableBookmarkId = "e41afed0-b317-4754-a159-543bef15da2e";
const jobId = "41aadfa4-3d22-4fd8-8494-c94fd88ce5de";

test("cloud workflow commands cover catalogue, runs, and saved workflows", async ({
  librettoCli,
  onTestFinished,
}) => {
  const requests: Array<{
    method: string;
    path: string;
    apiKey: string | undefined;
    body: unknown;
  }> = [];
  let statusCalls = 0;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const path = request.url ?? "";
    requests.push({
      method: request.method ?? "GET",
      path,
      apiKey:
        typeof request.headers["x-api-key"] === "string"
          ? request.headers["x-api-key"]
          : undefined,
      body: text ? JSON.parse(text) : null,
    });

    let body: unknown;
    if (path === "/v1/catalogue/search") {
      body = {
        json: {
          workflows: [
            {
              tenant_slug: "acme",
              workflow_name: "patient-lookup",
              description: "Find a patient",
            },
          ],
        },
      };
    } else if (path === "/v1/catalogue/get") {
      body = {
        json: {
          tenant_slug: "acme",
          workflow_name: "patient-lookup",
          input_schema: { type: "object" },
          credential_requirements: [],
        },
      };
    } else if (path === "/v1/catalogue/bookmarks/save") {
      body = {
        json: {
          bookmark: {
            id: bookmarkId,
            workflow: "acme/patient-lookup",
            alias: "patient",
          },
        },
      };
    } else if (path === "/v1/catalogue/bookmarks/list") {
      body = {
        json: {
          workflows: [
            {
              id: bookmarkId,
              alias: "patient",
              tenant_slug: "acme",
              workflow_name: "patient-lookup",
              default_params: { region: "west" },
              available: true,
            },
            {
              id: unavailableBookmarkId,
              alias: "retired",
              tenant_slug: null,
              workflow_name: null,
              available: false,
            },
          ],
        },
      };
    } else if (path === "/v1/catalogue/run") {
      body = { json: { job_id: jobId, status: "queued" } };
    } else if (path === "/v1/jobs/get") {
      statusCalls += 1;
      body = {
        json: {
          job_id: jobId,
          hosted_workflow_id: "hosted-workflow-1",
          status: statusCalls === 1 ? "running" : "completed",
          ...(statusCalls === 1 ? {} : { result: { patient_id: "p-1" } }),
        },
      };
    } else if (path === "/v1/catalogue/bookmarks/remove") {
      body = { json: { id: bookmarkId, removed: true } };
    } else {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: `Unexpected path ${path}` }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address() as AddressInfo;
  const env = {
    LIBRETTO_API_KEY: "test-api-key",
    LIBRETTO_API_URL: `http://127.0.0.1:${address.port}`,
  };

  const search = await librettoCli(
    "cloud catalogue search patient --limit 5 --json",
    env,
  );
  expect(JSON.parse(search.stdout)).toMatchObject({
    workflows: [{ workflow_name: "patient-lookup" }],
  });

  const get = await librettoCli(
    "cloud catalogue get acme/patient-lookup --json",
    env,
  );
  expect(JSON.parse(get.stdout)).toMatchObject({
    workflow: { workflow_name: "patient-lookup" },
    default_params: {},
  });

  const save = await librettoCli(
    `cloud catalogue save acme/patient-lookup --alias patient --defaults '{"region":"west"}' --json`,
    env,
  );
  expect(JSON.parse(save.stdout)).toMatchObject({ bookmark: { id: bookmarkId } });

  const saved = await librettoCli("cloud catalogue saved --json", env);
  expect(JSON.parse(saved.stdout).workflows).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ alias: "patient", available: true }),
    ]),
  );
  const savedHuman = await librettoCli("cloud catalogue saved", env);
  expect(savedHuman.stdout).toContain(
    `${unavailableBookmarkId}: retired (catalogue entry unavailable) [unavailable]`,
  );
  expect(savedHuman.stdout).not.toContain("null/null");

  const run = await librettoCli(
    `cloud catalogue run patient --params '{"patient_id":"p-1"}' --credentials '{"portal":"credential-1"}' --json`,
    env,
  );
  expect(JSON.parse(run.stdout)).toMatchObject({ job_id: jobId });

  const status = await librettoCli(
    `cloud catalogue status ${jobId} --watch --interval-seconds 0.1 --json`,
    env,
  );
  expect(JSON.parse(status.stdout)).toMatchObject({
    status: "completed",
    result: { patient_id: "p-1" },
  });
  expect(statusCalls).toBe(2);

  const remove = await librettoCli(
    `cloud catalogue remove ${bookmarkId} --json`,
    env,
  );
  expect(JSON.parse(remove.stdout)).toEqual({ id: bookmarkId, removed: true });

  expect(requests.every((request) => request.apiKey === "test-api-key")).toBe(
    true,
  );
  expect(
    requests.find(
      (request) =>
        request.path === "/v1/catalogue/run",
    )?.body,
  ).toEqual({
    json: {
      publisher: "acme",
      workflow: "patient-lookup",
      params: { region: "west", patient_id: "p-1" },
      credentials: { portal: "credential-1" },
      skip_callbacks: true,
    },
  });
  expect(
    requests
      .filter((request) => request.path.startsWith("/v1/catalogue"))
      .every((request) => request.method === "POST" && request.body !== null),
  ).toBe(true);
});

test("cloud workflow commands require an API key", async ({ librettoCli }) => {
  const result = await librettoCli("cloud catalogue search", {
    LIBRETTO_API_KEY: undefined,
  });
  expect(result.stderr).toContain(
    "LIBRETTO_API_KEY is required to search the workflow catalogue.",
  );
  expect(result.stderr).toContain("libretto cloud auth api-key issue");
});
