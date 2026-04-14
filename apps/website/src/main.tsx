import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { IcosahedronDebug } from "./IcosahedronDebug";

// Temporarily disabled.
// if (import.meta.env.DEV) {
//   void import("cssstudio").then(({ startStudio }) => {
//     startStudio();
//   });
// }

const path = window.location.pathname;

// Dev-only lazy imports — fully tree-shaken from production builds
const DevAgentation = import.meta.env.DEV
  ? lazy(() => import("agentation").then((module) => ({ default: module.Agentation })))
  : null;
const DevOgImage = import.meta.env.DEV
  ? lazy(() => import("./OgImage").then((m) => ({ default: m.OgImage })))
  : null;

createRoot(document.getElementById("app")!).render(
  <StrictMode>
    {path === "/og-image" && DevOgImage ? (
      <Suspense fallback={null}>
        <DevOgImage />
      </Suspense>
    ) : path === "/icosahedron" ? (
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
