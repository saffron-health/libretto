import { Outlet, createFileRoute, useRouterState } from "@tanstack/react-router";
import { BlogIndexPage } from "../blog/BlogPage";

export const Route = createFileRoute("/blog")({
  component: BlogRoute,
});

function BlogRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (pathname === "/blog" || pathname === "/blog/") {
    return <BlogIndexPage />;
  }

  return <Outlet />;
}
