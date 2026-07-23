import { createFileRoute } from "@tanstack/react-router";
import { GitHubSetupPage } from "../GitHubSetupPage";

export const Route = createFileRoute("/github/setup")({
  component: GitHubSetupPage,
});
