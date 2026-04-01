import { Suspense, lazy } from "react";
import { HomePage } from "./HomePage";

const DocsPage = lazy(() =>
  import("./docs/DocsPage").then((module) => ({ default: module.DocsPage })),
);

function normalizePath(pathname: string): string {
  if (pathname === "/") {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function App() {
  const pathname = normalizePath(window.location.pathname);

  if (pathname === "/docs" || pathname === "/docs/index.html") {
    return (
      <Suspense fallback={null}>
        <DocsPage />
      </Suspense>
    );
  }

  return <HomePage />;
}
