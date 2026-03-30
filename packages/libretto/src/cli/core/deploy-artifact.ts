import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

type PackageManifest = {
  name?: string;
  version?: string;
  packageManager?: string;
  main?: string;
  module?: string;
  source?: string;
  types?: string;
  exports?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  workspaces?: string[] | { packages?: string[] };
};

type WorkspacePackage = {
  dir: string;
  manifest: PackageManifest;
  name: string;
};

type HostedDeployPackage = {
  cleanup: () => void;
  entryPoint: string;
  outputDir: string;
};

type BuildHostedDeployTarballArgs = {
  additionalExternals?: readonly string[];
  deploymentName: string;
  entryPoint?: string;
  sourceDir: string;
};

type CreateHostedDeployPackageArgs = BuildHostedDeployTarballArgs;

const DEFAULT_RUNTIME_EXTERNALS = [
  "libretto",
  "playwright",
  "playwright-core",
  "chromium-bidi",
] as const;
const BUILT_IN_MANIFEST_DEPENDENCIES = ["libretto"] as const;
const SOURCE_FILE_EXTENSIONS = [
  "",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".mjs",
  ".cjs",
  "/index.ts",
  "/index.tsx",
  "/index.mts",
  "/index.cts",
  "/index.js",
  "/index.mjs",
  "/index.cjs",
] as const;
const CURRENT_LIBRETTO_VERSION = readCurrentLibrettoVersion();
const CURRENT_LIBRETTO_PACKAGE_DIR = fileURLToPath(
  new URL("../../..", import.meta.url),
);

function readCurrentLibrettoVersion(): string {
  const packageJsonPath = fileURLToPath(
    new URL("../../../package.json", import.meta.url),
  );
  const manifest = readJsonFile<PackageManifest>(packageJsonPath);
  if (!manifest.version) {
    throw new Error(
      `Unable to determine current libretto version from ${packageJsonPath}.`,
    );
  }
  return manifest.version;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function readPackageManifest(path: string): PackageManifest {
  return readJsonFile<PackageManifest>(path);
}

function ensureSourcePackageManifest(sourceDir: string): PackageManifest {
  const pkgJsonPath = join(sourceDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    throw new Error(
      `No package.json found in ${sourceDir}. Deploy source must contain a package.json.`,
    );
  }
  return readPackageManifest(pkgJsonPath);
}

function resolveEntryPointPath(sourceDir: string, entryPoint?: string): string {
  const candidate = entryPoint ?? "index.ts";
  const absEntryPoint = isAbsolute(candidate)
    ? resolve(candidate)
    : resolve(sourceDir, candidate);

  if (!existsSync(absEntryPoint)) {
    throw new Error(
      `Deploy entry point not found: ${absEntryPoint}. Pass --entry-point to choose a workflow file.`,
    );
  }

  return absEntryPoint;
}

function isRootPath(path: string): boolean {
  return dirname(path) === path;
}

function findWorkspaceRoot(startDir: string): string | null {
  let currentDir = resolve(startDir);

  while (true) {
    if (existsSync(join(currentDir, "pnpm-workspace.yaml"))) {
      return currentDir;
    }

    const pkgJsonPath = join(currentDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      const manifest = readPackageManifest(pkgJsonPath);
      if (manifest.workspaces) {
        return currentDir;
      }
    }

    if (isRootPath(currentDir)) {
      return null;
    }
    currentDir = dirname(currentDir);
  }
}

function readWorkspacePatterns(rootDir: string): string[] {
  const pnpmWorkspacePath = join(rootDir, "pnpm-workspace.yaml");
  if (existsSync(pnpmWorkspacePath)) {
    const patterns: string[] = [];
    let inPackagesBlock = false;

    for (const rawLine of readFileSync(pnpmWorkspacePath, "utf8").split(/\r?\n/)) {
      const trimmed = rawLine.trim();
      if (!inPackagesBlock) {
        if (trimmed === "packages:") {
          inPackagesBlock = true;
        }
        continue;
      }

      if (
        trimmed.length > 0 &&
        !trimmed.startsWith("-") &&
        !rawLine.startsWith(" ") &&
        !rawLine.startsWith("\t")
      ) {
        break;
      }

      const match = trimmed.match(/^-\s*["']?(.+?)["']?$/);
      if (match?.[1]) {
        patterns.push(match[1]);
      }
    }

    if (patterns.length > 0) {
      return patterns;
    }
  }

  const pkgJsonPath = join(rootDir, "package.json");
  if (!existsSync(pkgJsonPath)) {
    return [];
  }

  const manifest = readPackageManifest(pkgJsonPath);
  if (Array.isArray(manifest.workspaces)) {
    return manifest.workspaces;
  }
  if (manifest.workspaces && Array.isArray(manifest.workspaces.packages)) {
    return manifest.workspaces.packages;
  }

  return [];
}

function expandWorkspacePattern(rootDir: string, pattern: string): string[] {
  if (!pattern.includes("*")) {
    const absDir = resolve(rootDir, pattern);
    return existsSync(absDir) ? [absDir] : [];
  }

  if (!pattern.endsWith("/*")) {
    return [];
  }

  const baseDir = resolve(rootDir, pattern.slice(0, -2));
  if (!existsSync(baseDir)) {
    return [];
  }

  return readdirSync(baseDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(baseDir, entry.name));
}

function discoverWorkspacePackages(startDir: string): Map<string, WorkspacePackage> {
  const workspaceRoot = findWorkspaceRoot(startDir);
  if (!workspaceRoot) {
    return new Map();
  }

  const packages = new Map<string, WorkspacePackage>();
  for (const pattern of readWorkspacePatterns(workspaceRoot)) {
    for (const dir of expandWorkspacePattern(workspaceRoot, pattern)) {
      const pkgJsonPath = join(dir, "package.json");
      if (!existsSync(pkgJsonPath)) {
        continue;
      }
      const manifest = readPackageManifest(pkgJsonPath);
      if (!manifest.name) {
        continue;
      }
      packages.set(manifest.name, { dir, manifest, name: manifest.name });
    }
  }

  return packages;
}

function findMatchingWorkspacePackage(
  importPath: string,
  workspacePackages: Map<string, WorkspacePackage>,
): {
  info: WorkspacePackage;
  subpath: string;
} | null {
  const names = [...workspacePackages.keys()].sort((left, right) =>
    right.length - left.length,
  );

  for (const name of names) {
    if (importPath === name) {
      return {
        info: workspacePackages.get(name)!,
        subpath: ".",
      };
    }
    if (importPath.startsWith(`${name}/`)) {
      return {
        info: workspacePackages.get(name)!,
        subpath: `.${importPath.slice(name.length)}`,
      };
    }
  }

  return null;
}

function resolvePathCandidates(
  packageDir: string,
  target: string,
  replacement?: string,
): string | null {
  const value = replacement ? target.replace(/\*/g, replacement) : target;
  const absCandidate = resolve(packageDir, value);
  if (existsSync(absCandidate)) {
    return absCandidate;
  }

  for (const suffix of SOURCE_FILE_EXTENSIONS) {
    const fileCandidate = resolve(packageDir, `${value}${suffix}`);
    if (existsSync(fileCandidate)) {
      return fileCandidate;
    }
  }

  return null;
}

function resolveExportTarget(
  exportValue: unknown,
  packageDir: string,
  replacement?: string,
): string | null {
  if (typeof exportValue === "string") {
    return resolvePathCandidates(packageDir, exportValue, replacement);
  }

  if (Array.isArray(exportValue)) {
    for (const entry of exportValue) {
      const resolved = resolveExportTarget(entry, packageDir, replacement);
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  if (!exportValue || typeof exportValue !== "object") {
    return null;
  }

  const record = exportValue as Record<string, unknown>;
  for (const condition of [
    "types",
    "source",
    "import",
    "default",
    "module",
    "require",
  ]) {
    if (!(condition in record)) {
      continue;
    }
    const resolved = resolveExportTarget(record[condition], packageDir, replacement);
    if (resolved) {
      return resolved;
    }
  }

  for (const value of Object.values(record)) {
    const resolved = resolveExportTarget(value, packageDir, replacement);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveExportsSubpath(
  exportsField: unknown,
  packageDir: string,
  subpath: string,
): string | null {
  if (!exportsField) {
    return null;
  }

  if (subpath === ".") {
    const rootExport = resolveExportTarget(exportsField, packageDir);
    if (rootExport) {
      return rootExport;
    }
  }

  if (typeof exportsField !== "object" || Array.isArray(exportsField)) {
    return null;
  }

  const record = exportsField as Record<string, unknown>;
  const hasExplicitSubpathKeys = Object.keys(record).some((key) => key.startsWith("."));

  if (!hasExplicitSubpathKeys) {
    return subpath === "." ? resolveExportTarget(record, packageDir) : null;
  }

  const exactMatch = record[subpath];
  if (exactMatch !== undefined) {
    return resolveExportTarget(exactMatch, packageDir);
  }

  for (const [key, value] of Object.entries(record)) {
    const starIndex = key.indexOf("*");
    if (starIndex < 0) {
      continue;
    }
    const prefix = key.slice(0, starIndex);
    const suffix = key.slice(starIndex + 1);
    if (!subpath.startsWith(prefix) || !subpath.endsWith(suffix)) {
      continue;
    }
    const replacement = subpath.slice(prefix.length, subpath.length - suffix.length);
    const resolved = resolveExportTarget(value, packageDir, replacement);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function resolveWorkspaceSourcePath(
  info: WorkspacePackage,
  subpath: string,
): string | null {
  const viaExports = resolveExportsSubpath(info.manifest.exports, info.dir, subpath);
  if (viaExports) {
    return viaExports;
  }

  if (subpath === ".") {
    for (const field of [
      info.manifest.types,
      info.manifest.source,
      info.manifest.module,
      info.manifest.main,
    ]) {
      if (!field) {
        continue;
      }
      const resolved = resolvePathCandidates(info.dir, field);
      if (resolved) {
        return resolved;
      }
    }
  }

  const directSubpath = subpath === "." ? "index" : subpath.slice(2);
  return resolvePathCandidates(info.dir, directSubpath);
}

function workspaceSourcePlugin(
  workspacePackages: Map<string, WorkspacePackage>,
  externalPackages: ReadonlySet<string>,
) {
  return {
    name: "workspace-source-resolver",
    setup(buildApi: {
      onResolve: (
        options: { filter: RegExp },
        callback: (args: { path: string }) => { path: string } | null,
      ) => void;
    }) {
      // Workspace imports are treated as bundle input, so their code is
      // embedded into the generated implementation file. The deployed package
      // does not depend on the original monorepo layout or workspace:* links.
      buildApi.onResolve({ filter: /^[^./].*/ }, (args) => {
        if (externalPackages.has(args.path)) {
          return null;
        }

        const match = findMatchingWorkspacePackage(args.path, workspacePackages);
        if (!match) {
          return null;
        }

        const resolvedPath = resolveWorkspaceSourcePath(match.info, match.subpath);
        if (!resolvedPath) {
          throw new Error(
            `Unable to resolve workspace import "${args.path}" from ${match.info.dir}.`,
          );
        }

        return { path: resolvedPath };
      });
    },
  };
}

function normalizePackageName(name: string): string {
  const normalized = name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || "libretto-deployment";
}

function readDependencyVersionFromManifest(
  manifest: PackageManifest,
  packageName: string,
): string | null {
  for (const dependencyGroup of [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.peerDependencies,
    manifest.optionalDependencies,
  ]) {
    const version = dependencyGroup?.[packageName];
    if (version) {
      return version;
    }
  }

  return null;
}

function resolveDependencyVersion(
  sourceDir: string,
  packageName: string,
  fallbackVersion?: string,
): string {
  let currentDir = resolve(sourceDir);

  while (true) {
    const pkgJsonPath = join(currentDir, "package.json");
    if (existsSync(pkgJsonPath)) {
      const version = readDependencyVersionFromManifest(
        readPackageManifest(pkgJsonPath),
        packageName,
      );
      if (version) {
        return version;
      }
    }

    if (isRootPath(currentDir)) {
      break;
    }
    currentDir = dirname(currentDir);
  }

  if (fallbackVersion) {
    return fallbackVersion;
  }

  throw new Error(
    `Unable to determine a version for external package "${packageName}". Add it to your package.json or remove it from --external.`,
  );
}

function writeDeployManifest(args: {
  additionalExternals: readonly string[];
  deploymentName: string;
  librettoDependency: string;
  outputDir: string;
  sourceDir: string;
}): void {
  const dependencies = Object.fromEntries(
    [
      ...BUILT_IN_MANIFEST_DEPENDENCIES,
      ...args.additionalExternals,
    ].map((packageName) => [
      packageName,
      packageName === "libretto"
        ? args.librettoDependency
        : resolveDependencyVersion(args.sourceDir, packageName),
    ]),
  );

  writeFileSync(
    join(args.outputDir, "package.json"),
    JSON.stringify(
      {
        name: normalizePackageName(args.deploymentName),
        private: true,
        type: "module",
        dependencies,
      },
      null,
      2,
    ) + "\n",
  );
}

function shouldVendorCurrentLibretto(versionSpec: string): boolean {
  return (
    versionSpec.startsWith("file:") ||
    versionSpec.startsWith("link:") ||
    versionSpec.startsWith("workspace:") ||
    versionSpec.startsWith("portal:") ||
    versionSpec.includes("&path:")
  );
}

function resolveLibrettoDependency(sourceDir: string): string {
  const versionSpec = resolveDependencyVersion(
    sourceDir,
    "libretto",
    CURRENT_LIBRETTO_VERSION,
  );

  if (shouldVendorCurrentLibretto(versionSpec)) {
    return "file:./libretto";
  }

  return versionSpec;
}

function copyCurrentLibrettoPackage(outputDir: string): void {
  const bundledLibrettoDir = join(outputDir, "libretto");
  mkdirSync(bundledLibrettoDir, { recursive: true });
  cpSync(
    join(CURRENT_LIBRETTO_PACKAGE_DIR, "dist"),
    join(bundledLibrettoDir, "dist"),
    { recursive: true },
  );
  cpSync(
    join(CURRENT_LIBRETTO_PACKAGE_DIR, "package.json"),
    join(bundledLibrettoDir, "package.json"),
  );
}

function formatBuildError(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const candidate = error as Error & {
    errors?: Array<{ location?: { file?: string; line?: number; column?: number }; text?: string }>;
  };
  if (!Array.isArray(candidate.errors) || candidate.errors.length === 0) {
    return error.message;
  }

  return candidate.errors
    .map((entry) => {
      const location = entry.location?.file
        ? `${entry.location.file}:${entry.location.line ?? 0}:${entry.location.column ?? 0}`
        : "unknown";
      return `${location} ${entry.text ?? error.message}`;
    })
    .join("\n");
}

function extractExportNamesFromEsmBundle(bundleSource: string): string[] {
  const exportNames = new Set<string>();

  for (const entry of bundleSource.matchAll(
    /export\s+(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)/g,
  )) {
    exportNames.add(entry[1]!);
  }

  for (const entry of bundleSource.matchAll(/export\s+\{([^}]+)\};/g)) {
    const specifiers = entry[1]?.split(",") ?? [];
    for (const specifier of specifiers) {
      const trimmed = specifier.trim();
      if (!trimmed) {
        continue;
      }
      const aliasMatch = trimmed.match(
        /^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*|default)$/,
      );
      if (aliasMatch?.[2]) {
        exportNames.add(aliasMatch[2]);
        continue;
      }
      if (/^[A-Za-z_$][\w$]*$/.test(trimmed)) {
        exportNames.add(trimmed);
      }
    }
  }

  if (/\bexport\s+default\b/m.test(bundleSource)) {
    exportNames.add("default");
  }

  return [...exportNames];
}

function createBootstrapSource(args: {
  bundleBuffer: Buffer;
  deploymentName: string;
  exportNames: readonly string[];
}): string {
  const bundleHash = createHash("sha256")
    .update(args.bundleBuffer)
    .digest("hex")
    .slice(0, 16);
  const bundleBase64 = gzipSync(args.bundleBuffer, { level: 9 }).toString("base64");
  const outputPrefix = `${normalizePackageName(args.deploymentName)}-`;
  const hasDefaultExport = args.exportNames.includes("default");
  const exportLines = args.exportNames
    .filter((name) => name !== "default")
    .map(
      (name) => `export const ${name} = createWorkflowProxy(${JSON.stringify(name)});`,
    )
    .join("\n");
  const defaultExportLine = hasDefaultExport
    ? 'export default createWorkflowProxy("default");'
    : "";

  // The deploy entrypoint is tiny on purpose. Hosted build imports this module
  // to discover workflow exports. The implementation bundle stays embedded in
  // the file, while external packages are resolved from node_modules when the
  // deployed code loads them.
  return `import { createRequire } from "node:module";
import { existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { workflow } from "libretto";

const BUNDLE_HASH = ${JSON.stringify(bundleHash)};
const BUNDLE_GZIP_BASE64 = ${JSON.stringify(bundleBase64)};
const BUNDLE_FILENAME = join(
  tmpdir(),
  ${JSON.stringify(outputPrefix)} + BUNDLE_HASH + ".cjs",
);
const nativeRequire = createRequire(
  join(tmpdir(), ${JSON.stringify("libretto-deploy-bootstrap.cjs")}),
);

function ensureBundleFile() {
  if (!existsSync(BUNDLE_FILENAME)) {
    writeFileSync(
      BUNDLE_FILENAME,
      gunzipSync(Buffer.from(BUNDLE_GZIP_BASE64, "base64")),
    );
  }

  return BUNDLE_FILENAME;
}

function createWorkflowProxy(exportName) {
  return workflow(exportName, async (ctx, input) => {
    const impl = nativeRequire(ensureBundleFile());
    const target = impl[exportName];
    if (!target || typeof target.run !== "function") {
      throw new Error(
        \`Expected workflow export "\${exportName}" to be available in the bundled deployment implementation.\`,
      );
    }
    return await target.run(ctx, input);
  });
}

${exportLines}
${defaultExportLine}
`;
}

export async function createHostedDeployPackage(
  args: CreateHostedDeployPackageArgs,
): Promise<HostedDeployPackage> {
  const absSourceDir = resolve(args.sourceDir);
  ensureSourcePackageManifest(absSourceDir);

  const absEntryPoint = resolveEntryPointPath(absSourceDir, args.entryPoint);
  const tempRoot = mkdtempSync(join(tmpdir(), "libretto-deploy-"));
  const outputDir = join(tempRoot, "deploy");
  mkdirSync(outputDir, { recursive: true });
  const librettoDependency = resolveLibrettoDependency(absSourceDir);

  const additionalExternals = [...new Set(args.additionalExternals ?? [])];
  // These packages stay out of the implementation bundle. The generated
  // package.json carries them into deploy-time installation, and the deployed
  // code resolves them from node_modules.
  const externalPackages = new Set<string>([
    ...DEFAULT_RUNTIME_EXTERNALS,
    ...additionalExternals,
  ]);
  const workspacePackages = discoverWorkspacePackages(absSourceDir);

  try {
    // The implementation bundle is CommonJS so the bootstrap can load it lazily
    // with createRequire() after workflow discovery, while external packages
    // continue to load through normal Node module resolution.
    const implementationBuild = await build({
      absWorkingDir: absSourceDir,
      bundle: true,
      entryPoints: [absEntryPoint],
      external: [...externalPackages],
      format: "cjs",
      outfile: "prebundled.cjs",
      platform: "node",
      plugins: [workspaceSourcePlugin(workspacePackages, externalPackages)],
      splitting: false,
      target: "node20",
      write: false,
    });

    const bundledImplementation = implementationBuild.outputFiles?.find((file) =>
      file.path.endsWith("prebundled.cjs"),
    );
    if (!bundledImplementation) {
      throw new Error("Bundler did not produce a deployment implementation file.");
    }

    // A separate ESM bundle is used only to read the entry module's exported
    // workflow names. Scanning the CommonJS bundle would also see exports from
    // bundled dependencies, which is not the deploy surface.
    const exportBuild = await build({
      absWorkingDir: absSourceDir,
      bundle: true,
      entryPoints: [absEntryPoint],
      external: [...externalPackages],
      format: "esm",
      outfile: "entry-exports.js",
      platform: "node",
      plugins: [workspaceSourcePlugin(workspacePackages, externalPackages)],
      splitting: false,
      target: "node20",
      write: false,
    });

    const bundledExports = exportBuild.outputFiles?.find((file) =>
      file.path.endsWith("entry-exports.js"),
    );
    if (!bundledExports) {
      throw new Error("Bundler did not produce an export analysis file.");
    }

    const exportNames = extractExportNamesFromEsmBundle(bundledExports.text);
    if (exportNames.length === 0) {
      throw new Error(
        `No named exports were found in ${absEntryPoint}. Hosted deploy expects the entry point to export one or more workflows.`,
      );
    }

    writeFileSync(
      join(outputDir, "index.js"),
      createBootstrapSource({
        bundleBuffer: Buffer.from(bundledImplementation.contents),
        deploymentName: args.deploymentName,
        exportNames,
      }),
    );
  } catch (error) {
    rmSync(tempRoot, { force: true, recursive: true });
    throw new Error(
      `Failed to bundle deploy entry point ${absEntryPoint}.\n${formatBuildError(error)}`,
    );
  }

  if (librettoDependency === "file:./libretto") {
    copyCurrentLibrettoPackage(outputDir);
  }

  // The generated manifest lists only packages that stay outside the
  // implementation bundle. Hosted deploy installs them into the deployed
  // package, and the deployed code loads them from node_modules.
  writeDeployManifest({
    additionalExternals,
    deploymentName: args.deploymentName,
    librettoDependency,
    outputDir,
    sourceDir: absSourceDir,
  });

  return {
    cleanup: () => {
      rmSync(tempRoot, { force: true, recursive: true });
    },
    entryPoint: "index.js",
    outputDir,
  };
}

export async function buildHostedDeployTarball(
  args: BuildHostedDeployTarballArgs,
): Promise<{ entryPoint: string; source: string }> {
  const deployPackage = await createHostedDeployPackage(args);

  try {
    const tarPath = join(dirname(deployPackage.outputDir), "source.tar.gz");
    execFileSync("tar", ["czf", tarPath, "-C", deployPackage.outputDir, "."], {
      stdio: "pipe",
    });

    return {
      entryPoint: deployPackage.entryPoint,
      source: readFileSync(tarPath).toString("base64"),
    };
  } finally {
    deployPackage.cleanup();
  }
}
