import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../HomePage";

export const Route = createFileRoute("/")({
  component: HomePage,
});
