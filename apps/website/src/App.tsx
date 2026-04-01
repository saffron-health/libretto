import { Suspense, lazy } from "react";
import { useLocation } from "wouter";
import { HomePage } from "./HomePage";
import { normalizeDocsPath } from "./docs/content";

const DocsPage = lazy(() =>
  import("./docs/DocsPage").then((module) => ({ default: module.DocsPage })),
);

export function App() {
  const [href] = useLocation();
  const pathname = normalizeDocsPath(
    new URL(href, window.location.origin).pathname,
  );

  if (pathname === "/docs" || pathname === "/docs/index.html" || pathname.startsWith("/docs/")) {
    return (
      <Suspense fallback={null}>
        <DocsPage pathname={pathname} />
      </Suspense>
    );
  }

  return <HomePage />;
}
