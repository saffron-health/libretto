---
name: errore
repo: remorses/errore
description: >
  Errore is the errors-as-values convention for TypeScript. Read this skill
  before adding or changing expected-failure paths in packages/browser-tools.
  It uses Error | T unions, tagged errors, instanceof narrowing, and flat early
  returns while preserving thrown errors at public compatibility boundaries.
version: 0.11.0
---

# Errore

Use [errore.org](https://errore.org/) for expected failures in
`packages/browser-tools`. Keep existing public error behavior unless the task
explicitly changes that contract.

## Rules

1. Import with `import * as errore from "errore"`.
2. Return expected failures as tagged error values from internal functions.
3. Keep unexpected host failures as thrown errors.
4. Check `instanceof Error` immediately and return early.
5. Use `errore.createTaggedError()` for domain errors.
6. Preserve the original failure with `cause`.
7. Convert third-party exceptions at the lowest boundary.
8. Do not return `unknown | Error`; narrow or cast the success value first.
9. Do not silently discard an error value.
10. Keep public rejected-promise contracts by throwing the error value at the
    compatibility boundary.

## Define a tagged error

```ts
import * as errore from "errore";

class AuthProfileError extends errore.createTaggedError({
  name: "AuthProfileError",
  message: "$message $recovery",
}) {}
```

Tagged errors extend `Error`, so `try/catch`, `instanceof Error`, logging, and
error monitoring continue to work.

## Return and handle expected failures

```ts
function resolveProfile(name: string) {
  if (!name) {
    return new AuthProfileError({
      message: "Auth profile name is empty.",
      recovery: "Pass a non-empty authProfile to browser_open.",
    });
  }
  return { name };
}

const profile = resolveProfile(input.authProfile);
if (profile instanceof Error) return profile;

return openWithProfile(profile);
```

Keep the success path at the root indentation level. Do not add `else` after an
error return.

## Wrap external failures

Use `.catch()` for async boundaries and `errore.try()` for sync boundaries.

```ts
const response = await fetch(url).catch(
  (cause) =>
    new ProviderRequestError({
      provider,
      cause,
    }),
);
if (response instanceof Error) return response;
```

Never return a raw caught value. Wrap it in a tagged domain error with `cause`.

## Preserve public compatibility

Internal helpers may return `AuthProfileError | T`. If an existing public API
rejects on failure, keep that contract:

```ts
const profile = resolveProfile(options.authProfile);
if (profile instanceof Error) throw profile;

return createProviderSession(profile);
```

Consumers can continue to use ordinary `try/catch` and `instanceof Error`.
