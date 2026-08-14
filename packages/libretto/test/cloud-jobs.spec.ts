import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect } from "vitest";
import { test } from "./fixtures";

const jobId = "41aadfa4-3d22-4fd8-8494-c94fd88ce5de";
const hostedJobId = "668fdf88-429f-40fb-8a46-9f38b6422031";

test("cloud jobs status watches a tenant-owned deployed workflow job", async ({
  librettoCli,
  onTestFinished,
}) => {
  let statusCalls = 0;
  const requests: Array<{ apiKey: string | undefined; body: unknown }> = [];
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    requests.push({
      apiKey:
        typeof request.headers["x-api-key"] === "string"
          ? request.headers["x-api-key"]
          : undefined,
      body: text ? JSON.parse(text) : null,
    });
    statusCalls += 1;
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        json: {
          job_id: jobId,
          status: statusCalls === 1 ? "running" : "completed",
          ...(statusCalls === 1 ? {} : { result: { ok: true } }),
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address() as AddressInfo;

  const result = await librettoCli(
    `cloud jobs status ${jobId} --watch --interval-seconds 0.1 --json`,
    {
      LIBRETTO_API_KEY: "test-api-key",
      LIBRETTO_API_URL: `http://127.0.0.1:${address.port}`,
    },
  );

  expect(JSON.parse(result.stdout)).toMatchObject({
    job_id: jobId,
    status: "completed",
    result: { ok: true },
  });
  expect(statusCalls).toBe(2);
  expect(requests).toEqual([
    { apiKey: "test-api-key", body: { json: { id: jobId } } },
    { apiKey: "test-api-key", body: { json: { id: jobId } } },
  ]);
});

test("cloud jobs status directs catalogue runs to catalogue", async ({
  librettoCli,
  onTestFinished,
}) => {
  const server = createServer(async (_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        json: {
          job_id: hostedJobId,
          hosted_workflow_id: "hosted-workflow-1",
          status: "running",
        },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  onTestFinished(
    () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  );
  const address = server.address() as AddressInfo;

  const result = await librettoCli(`cloud jobs status ${hostedJobId}`, {
    LIBRETTO_API_KEY: "test-api-key",
    LIBRETTO_API_URL: `http://127.0.0.1:${address.port}`,
  });

  expect(result.stderr).toContain(
    `libretto cloud catalogue status ${hostedJobId}`,
  );
});
