import { createFileRoute } from "@tanstack/react-router";
import { OnboardingPage } from "../OnboardingPage";

export const Route = createFileRoute("/onboarding")({
  component: OnboardingPage,
});
