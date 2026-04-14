import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { startStudio } from "cssstudio";
import "./index.css";
import { App } from "./App";
import { IcosahedronDebug } from "./IcosahedronDebug";

if (import.meta.env.DEV) {
  startStudio();
}

const path = window.location.pathname;
const DevAgentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((module) => ({ default: module.Agentation })))
  : null;

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    {path === "/icosahedron" ? (
      <IcosahedronDebug />
    ) : (
      <>
        <App />
        {DevAgentation ? (
          <Suspense fallback={null}>
            <DevAgentation />
          </Suspense>
        ) : null}
      </>
    )}
  </StrictMode>,
);
