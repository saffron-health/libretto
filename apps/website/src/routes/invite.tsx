import { createFileRoute } from "@tanstack/react-router";
import { InvitePage } from "../InvitePage";

export const Route = createFileRoute("/invite")({
  component: InvitePage,
});
