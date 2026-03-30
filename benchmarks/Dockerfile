FROM mcr.microsoft.com/playwright:v1.58.2-noble

# Enable corepack for pnpm
RUN corepack enable && corepack prepare pnpm@9.15.4 --activate

WORKDIR /app

# Copy package manifests first for better layer caching
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY .npmrc .npmrc
COPY packages/libretto/package.json packages/libretto/
COPY packages/libretto/scripts/ packages/libretto/scripts/
COPY packages/libretto/skills/ packages/libretto/skills/
COPY benchmarks/package.json benchmarks/
COPY apps/website/package.json apps/website/
COPY evals/package.json evals/

RUN pnpm install --frozen-lockfile

# Copy the rest of the repo
COPY . .

# Build all packages
RUN pnpm build

ENTRYPOINT ["pnpm", "--filter", "libretto-benchmarks", "exec", "tsx", "webVoyager/cloud-entrypoint.ts"]