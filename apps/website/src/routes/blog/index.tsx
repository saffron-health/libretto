import { createFileRoute } from "@tanstack/react-router";
import { BlogIndexPage } from "../../blog/BlogPage";

export const Route = createFileRoute("/blog/")({
  component: BlogIndexPage,
});
