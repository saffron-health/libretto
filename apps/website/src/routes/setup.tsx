import { createFileRoute } from "@tanstack/react-router";
import { SetupPage } from "../SetupPage";

export const Route = createFileRoute("/setup")({
  component: SetupPage,
});
