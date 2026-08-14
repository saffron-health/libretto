import { createFileRoute } from "@tanstack/react-router";
import { OAuthContinuePage } from "../OAuthContinuePage";

export const Route = createFileRoute("/oauth/continue")({
  component: OAuthContinuePage,
});
