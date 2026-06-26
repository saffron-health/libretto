import { StartClient } from "@tanstack/react-start/client";
import { StrictMode } from "react";
import { hydrateRoot } from "react-dom/client";
import { initializeFathomClickTracking } from "./analytics";

initializeFathomClickTracking();

hydrateRoot(
  document,
  <StrictMode>
    <StartClient />
  </StrictMode>,
);
