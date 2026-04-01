import introduction from "./pages/introduction.mdx?raw";
import uiKit from "./pages/ui-kit.mdx?raw";
import quickstart from "./pages/quickstart.mdx?raw";
import configuration from "./pages/configuration.mdx?raw";
import openAndConnect from "./pages/open-and-connect.mdx?raw";
import snapshot from "./pages/snapshot.mdx?raw";
import exec from "./pages/exec.mdx?raw";
import networkAndActions from "./pages/network-and-actions.mdx?raw";
import sessionManagement from "./pages/session-management.mdx?raw";
import runAndResume from "./pages/run-and-resume.mdx?raw";
import workflow from "./pages/workflow.mdx?raw";
import logging from "./pages/logging.mdx?raw";
import instrumentation from "./pages/instrumentation.mdx?raw";
import extraction from "./pages/extraction.mdx?raw";
import network from "./pages/network.mdx?raw";
import recovery from "./pages/recovery.mdx?raw";

export type DocsContentPage = {
  id: string;
  label: string;
  content: string;
};

export type DocsContentGroup = {
  id: string;
  label: string;
  path: string;
  pages: DocsContentPage[];
};

export const defaultDocsGroupId = "get-started";

const isDocsDevBuild =
  !import.meta.env.PROD ||
  (typeof window !== "undefined" &&
    ["localhost", "127.0.0.1"].includes(window.location.hostname));

const devDocsManifest = isDocsDevBuild
  ? [
      {
        id: "ui-kit",
        label: "UI Kit",
        path: "/docs/ui-kit",
        pages: [{ id: "ui-kit-components", label: "Components", content: uiKit }],
      },
    ]
  : [];

export const docsManifest = [
  ...devDocsManifest,
  {
    id: "get-started",
    label: "Get Started",
    path: "/docs/get-started",
    pages: [
      { id: "introduction", label: "Introduction", content: introduction },
      { id: "quickstart", label: "Quick start", content: quickstart },
      { id: "configuration", label: "Configuration", content: configuration },
    ],
  },
  {
    id: "cli-reference",
    label: "CLI Reference",
    path: "/docs/cli-reference",
    pages: [
      {
        id: "open-and-connect",
        label: "open & connect",
        content: openAndConnect,
      },
      { id: "snapshot", label: "snapshot", content: snapshot },
      { id: "exec", label: "exec", content: exec },
      {
        id: "run-and-resume",
        label: "run & resume",
        content: runAndResume,
      },
      {
        id: "network-and-actions",
        label: "network & actions",
        content: networkAndActions,
      },
      {
        id: "session-management",
        label: "save, pages & close",
        content: sessionManagement,
      },
    ],
  },
  {
    id: "library-api",
    label: "Library API",
    path: "/docs/library-api",
    pages: [
      { id: "workflow", label: "Workflow", content: workflow },
      { id: "extraction", label: "AI Extraction", content: extraction },
      { id: "network", label: "Network", content: network },
      { id: "recovery", label: "Recovery", content: recovery },
      {
        id: "instrumentation",
        label: "Instrumentation",
        content: instrumentation,
      },
      { id: "logging", label: "Logging", content: logging },
    ],
  },
] satisfies DocsContentGroup[];

export const docsPages = docsManifest.flatMap((group) => {
  return group.pages;
});

export function normalizeDocsPath(pathname: string): string {
  if (pathname === "/" || pathname.length === 0) {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function getDefaultDocsGroup() {
  return (
    docsManifest.find((group) => {
      return group.id === defaultDocsGroupId;
    }) ?? docsManifest[0]
  );
}

export function getDocsGroupByPath(pathname: string) {
  const normalizedPath = normalizeDocsPath(pathname);

  if (normalizedPath === "/docs" || normalizedPath === "/docs/index.html") {
    return getDefaultDocsGroup();
  }

  return docsManifest.find((group) => {
    return group.path === normalizedPath;
  });
}

export const docsMdxContent = docsPages
  .map((page) => {
    return page.content;
  })
  .join("\n\n");
