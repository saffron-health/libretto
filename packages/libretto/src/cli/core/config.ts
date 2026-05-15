import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { SessionAccessModeSchema } from "../../runtime/state/index.js";
import { LIBRETTO_CONFIG_PATH } from "./context.js";

export const CURRENT_CONFIG_VERSION = 1;

export const ViewportConfigSchema = z.object({
  width: z.number().int().min(1),
  height: z.number().int().min(1),
});
export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const WindowPositionConfigSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
});
export type WindowPositionConfig = z.infer<typeof WindowPositionConfigSchema>;

export const LibrettoConfigSchema = z
  .object({
    version: z.literal(CURRENT_CONFIG_VERSION),
    snapshotModel: z.string().min(1).optional(),
    viewport: ViewportConfigSchema.optional(),
    windowPosition: WindowPositionConfigSchema.optional(),
    provider: z.string().optional(),
    sessionMode: SessionAccessModeSchema.optional(),
    experiments: z.record(z.string(), z.boolean()).optional(),
  })
  .passthrough();
export type LibrettoConfig = z.infer<typeof LibrettoConfigSchema>;

function formatConfigIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("\n");
}

function formatExpectedConfigExample(): string {
  return JSON.stringify(
    {
      version: CURRENT_CONFIG_VERSION,
      viewport: {
        width: 1280,
        height: 800,
      },
      windowPosition: {
        x: 1600,
        y: 120,
      },
      sessionMode: "write-access",
    },
    null,
    2,
  );
}

function invalidConfigError(configPath: string, detail?: string): Error {
  return new Error(
    [
      `Config is invalid at ${configPath}.`,
      detail ? `Problems:\n${detail}` : null,
      "Expected config example:",
      formatExpectedConfigExample(),
      "Notes:",
      '  - "viewport", "windowPosition", and "sessionMode" are optional.',
      '  - "snapshotModel" is deprecated and ignored by snapshot.',
      "Fix the file to match this shape, or delete it and rerun setup.",
    ]
      .filter(Boolean)
      .join("\n"),
  );
}

function parseConfig(raw: string, configPath: string): LibrettoConfig {
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (error) {
    throw invalidConfigError(
      configPath,
      `  - root: Invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const parsed = LibrettoConfigSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw invalidConfigError(configPath, formatConfigIssues(parsed.error));
  }
  return parsed.data;
}

export function readLibrettoConfig(
  configPath: string = LIBRETTO_CONFIG_PATH,
): LibrettoConfig {
  if (!existsSync(configPath)) {
    return { version: CURRENT_CONFIG_VERSION };
  }
  return parseConfig(readFileSync(configPath, "utf-8"), configPath);
}

export function writeLibrettoConfig(
  config: LibrettoConfig,
  configPath: string = LIBRETTO_CONFIG_PATH,
): LibrettoConfig {
  const parsed = LibrettoConfigSchema.parse(config);
  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, JSON.stringify(parsed, null, 2), "utf-8");
  return parsed;
}

export function readSnapshotModel(
  configPath: string = LIBRETTO_CONFIG_PATH,
): string | null {
  return readLibrettoConfig(configPath).snapshotModel ?? null;
}

export function writeSnapshotModel(
  model: string,
  configPath: string = LIBRETTO_CONFIG_PATH,
): string {
  let librettoConfig: LibrettoConfig;
  try {
    librettoConfig = readLibrettoConfig(configPath);
  } catch {
    // Existing config is malformed — start fresh so repair flows can
    // overwrite a broken file instead of throwing.
    librettoConfig = { version: CURRENT_CONFIG_VERSION };
  }
  writeLibrettoConfig(
    {
      ...librettoConfig,
      version: CURRENT_CONFIG_VERSION,
      snapshotModel: model,
    },
    configPath,
  );
  return model;
}

export function clearSnapshotModel(
  configPath: string = LIBRETTO_CONFIG_PATH,
): boolean {
  const librettoConfig = readLibrettoConfig(configPath);
  if (!librettoConfig.snapshotModel) return false;
  const { snapshotModel: _, ...rest } = librettoConfig;
  writeLibrettoConfig(
    {
      ...rest,
    },
    configPath,
  );
  return true;
}
