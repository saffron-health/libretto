import { createFileRoute } from "@tanstack/react-router";
import { PlaywrightCodegenPage } from "../vs/PlaywrightCodegenPage";

export const Route = createFileRoute("/vs/playwright-codegen")({
  component: PlaywrightCodegenPage,
});
