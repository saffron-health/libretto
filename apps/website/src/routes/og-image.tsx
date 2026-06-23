import { createFileRoute } from "@tanstack/react-router";
import { OgImage } from "../OgImage";

export const Route = createFileRoute("/og-image")({
  component: OgImage,
});
