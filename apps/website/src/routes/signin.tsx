import { createFileRoute } from "@tanstack/react-router";
import { SignInPage } from "../SignInPage";

export const Route = createFileRoute("/signin")({
  component: SignInPage,
});
