import { useLocation } from "wouter";
import { HomePage } from "./HomePage";
import { BlogIndexPage, BlogPostPage } from "./blog/BlogPage";
import { normalizeAppPathname } from "./routing";

export function App() {
  const [location] = useLocation();
  const pathname = normalizeAppPathname(location);

  if (pathname === "/blog") {
    return <BlogIndexPage />;
  }

  if (pathname.startsWith("/blog/")) {
    return <BlogPostPage slug={pathname.slice("/blog/".length)} />;
  }

  return <HomePage />;
}
