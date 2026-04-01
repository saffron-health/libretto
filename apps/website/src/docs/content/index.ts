import introduction from "./pages/introduction.mdx?raw";
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
  pages: DocsContentPage[];
};

export const docsManifest = [
  {
    id: "get-started",
    label: "Get Started",
    pages: [
      { id: "introduction", label: "Introduction", content: introduction },
      { id: "quickstart", label: "Quick start", content: quickstart },
      { id: "configuration", label: "Configuration", content: configuration },
    ],
  },
  {
    id: "cli-reference",
    label: "CLI Reference",
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

export const docsMdxContent = docsPages
  .map((page) => {
    return page.content;
  })
  .join("\n\n");
