import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../index.css";
import { BrandKitPage } from "./BrandKitPage.js";

createRoot(document.getElementById("brand-kit")!).render(
  <StrictMode>
    <BrandKitPage />
  </StrictMode>,
);
