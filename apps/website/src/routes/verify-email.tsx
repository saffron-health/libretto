import { createFileRoute } from "@tanstack/react-router";
import { VerifyEmailPage } from "../VerifyEmailPage";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
});
