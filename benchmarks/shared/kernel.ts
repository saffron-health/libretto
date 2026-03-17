function normalizeEnvValue(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function requireBenchmarkKernelApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const value = normalizeEnvValue(env.BENCHMARKS_KERNEL_API_KEY);
  if (value) {
    return value;
  }

  throw new Error(
    [
      "Kernel benchmark configuration missing.",
      "Expected BENCHMARKS_KERNEL_API_KEY to be set in the environment.",
      "Configure the GitHub secret/environment variable before running benchmarks.",
    ].join("\n"),
  );
}
