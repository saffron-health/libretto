FROM mcr.microsoft.com/playwright:v1.58.2-noble

WORKDIR /app

RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/website/package.json apps/website/
COPY benchmarks/package.json benchmarks/
COPY evals/package.json evals/
COPY packages/libretto/package.json packages/libretto/
COPY packages/libretto/scripts/ packages/libretto/scripts/
COPY packages/libretto/skills/ packages/libretto/skills/
COPY packages/dev-tools/package.json packages/dev-tools/
COPY packages/create-libretto/package.json packages/create-libretto/
COPY packages/affordance/package.json packages/affordance/

RUN pnpm install --frozen-lockfile

COPY . .

RUN pnpm -s turbo run build --filter=@libretto/evals^... --output-logs=errors-only --log-prefix=none
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3-venv \
  && rm -rf /var/lib/apt/lists/*
RUN python3 -m venv /opt/browser-use-venv \
  && /opt/browser-use-venv/bin/pip install --upgrade pip \
  && /opt/browser-use-venv/bin/pip install browser-use

ENV BROWSER_USE_EVAL_PYTHON=/opt/browser-use-venv/bin/python

ENTRYPOINT ["pnpm", "--dir", "evals", "-s", "exec", "tsx", "cloud-entrypoint.ts"]
