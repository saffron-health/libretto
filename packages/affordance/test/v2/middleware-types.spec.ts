import { describe, test } from "vitest";
import { z } from "zod";
import { Aff } from "../../src/v2/index.js";

type Session = {
  id: string;
};

type Logger = {
  debug(message: string): void;
};

describe("Aff v2 middleware types", () => {
  test("a second middleware sees context injected by the first middleware", () => {
    const addSession = Aff.middleware().handle<{ session: Session }>(
      async ({ next }) => next({ ctx: { session: { id: "session-1" } } }),
    );

    const addLogger = Aff.middleware()
      .$context<{ session: Session }>()
      .handle<{ logger: Logger }>(async ({ ctx, next }) => {
        const sessionId: string = ctx.session.id;

        return next({
          ctx: {
            logger: {
              debug(message) {
                `${sessionId}:${message}`;
              },
            },
          },
        });
      });

    Aff.command({ description: "Open URL" })
      .use(addSession)
      .use(addLogger)
      .handle(({ ctx }) => {
        const sessionId: string = ctx.session.id;
        ctx.logger.debug(sessionId);

        return sessionId;
      });
  });

  test("handlers reject unprovided context keys", () => {
    Aff.command({ description: "Open URL" }).handle(({ ctx }) => {
      // @ts-expect-error session was not provided by any prior middleware
      return ctx.session;
    });
  });

  test("middleware rejects context contracts that prior middleware has not provided", () => {
    const needsSession = Aff.middleware()
      .$context<{ session: Session }>()
      .handle(async ({ ctx, next }) => {
        const sessionId: string = ctx.session.id;
        return next({ ctx: { sessionId } });
      });

    Aff.command({ description: "Open URL" })
      // @ts-expect-error needsSession requires session context before it can run
      .use(needsSession)
      .handle(async () => "opened");
  });

  test("CLI and group middleware chains carry context between their own middlewares", () => {
    const addSession = Aff.middleware().handle<{ session: Session }>(
      async ({ next }) => next({ ctx: { session: { id: "session-1" } } }),
    );

    const needsSession = Aff.middleware()
      .$context<{ session: Session }>()
      .handle(async ({ ctx, next }) => {
        const sessionId: string = ctx.session.id;
        return next({ ctx: { sessionId } });
      });

    Aff.cli("libretto").use(addSession).use(needsSession).routes({});
    Aff.group({ description: "Cloud commands" })
      .use(addSession)
      .use(needsSession)
      .routes({});
  });

  test("next ctx patches must match the declared provided context", () => {
    Aff.middleware().handle<{ session: Session }>(async ({ next }) =>
      next({
        ctx: {
          session: {
            // @ts-expect-error session id must be a string
            id: 123,
          },
        },
      }),
    );
  });

  test("$input contracts type middleware input", () => {
    const needsUrlInput = Aff.middleware()
      .$input<{ url: string }>()
      .handle<{ url: string }>(async ({ input, next }) => {
        const url: string = input.url;
        return next({ ctx: { url } });
      });

    Aff.command({ description: "Open URL" })
      .arguments([["url", z.string()]])
      .use(needsUrlInput)
      .handle(({ ctx }) => {
        const url: string = ctx.url;
        return url;
      });

    Aff.command({ description: "Open URL" })
      // @ts-expect-error this command does not provide the url input required by the middleware
      .use(needsUrlInput)
      .handle(async () => "opened");
  });
});
