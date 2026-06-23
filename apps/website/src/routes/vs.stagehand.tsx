import { createFileRoute } from "@tanstack/react-router";
import { StagehandPage } from "../vs/StagehandPage";

export const Route = createFileRoute("/vs/stagehand")({
  component: StagehandPage,
});
