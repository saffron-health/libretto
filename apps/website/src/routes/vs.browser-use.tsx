import { createFileRoute } from "@tanstack/react-router";
import { BrowserUsePage } from "../vs/BrowserUsePage";

export const Route = createFileRoute("/vs/browser-use")({
  component: BrowserUsePage,
});
