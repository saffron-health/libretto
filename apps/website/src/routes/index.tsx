import { createFileRoute } from "@tanstack/react-router";
import { HomePage } from "../HomePage";

export const Route = createFileRoute("/")({
  head: () => ({
    links: [{ rel: "canonical", href: "https://libretto.sh/" }],
  }),
  component: HomePage,
});
