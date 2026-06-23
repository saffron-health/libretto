import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import type { ReactNode } from "react";
import "../index.css";

const DEFAULT_TITLE = "Libretto | Turn website workflows into reliable APIs";
const DEFAULT_DESCRIPTION =
  "Deterministic browser automation for AI agents and developers. Build fast, reliable scripts with agent-friendly debugging and seamless cloud deployment.";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1.0" },
      { title: DEFAULT_TITLE },
      { name: "description", content: DEFAULT_DESCRIPTION },
      { property: "og:type", content: "website" },
      { property: "og:title", content: DEFAULT_TITLE },
      { property: "og:description", content: DEFAULT_DESCRIPTION },
      { property: "og:url", content: "https://libretto.sh" },
      { property: "og:image", content: "https://libretto.sh/og-image.png" },
      { property: "og:image:width", content: "1280" },
      { property: "og:image:height", content: "640" },
      { property: "og:site_name", content: "Libretto" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: DEFAULT_TITLE },
      { name: "twitter:description", content: DEFAULT_DESCRIPTION },
      { name: "twitter:image", content: "https://libretto.sh/og-image.png" },
    ],
    links: [
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logos/logo-light.svg",
        media: "(prefers-color-scheme: light)",
      },
      {
        rel: "icon",
        type: "image/svg+xml",
        href: "/logos/logo-dark.svg",
        media: "(prefers-color-scheme: dark)",
      },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,300;9..144,400;9..144,500;9..144,600;9..144,700&display=swap",
      },
      { rel: "canonical", href: "https://libretto.sh/" },
    ],
    scripts: [
      {
        src: "https://cdn.usefathom.com/script.js",
        "data-site": "OSJVKIKF",
        defer: true,
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <Outlet />
    </RootDocument>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
