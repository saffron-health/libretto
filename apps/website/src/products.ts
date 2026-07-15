export interface ProductLink {
  href: string;
  name: string;
  tagline: string;
  kicker: string;
  status: "live" | "soon";
  fathomEvent: string;
}

export const PRODUCTS: ProductLink[] = [
  {
    href: "/cli",
    name: "Libretto CLI",
    tagline:
      "Open-source CLI that turns website workflows into fast, reusable scripts in your codebase.",
    kicker: "// CLI --",
    status: "live",
    fathomEvent: "Product listing cli click",
  },
  {
    href: "/debug-agents",
    name: "Debug Agents",
    tagline:
      "When Playwright automations fail, an agent inspects the live page and opens a pull request with the fix.",
    kicker: "// DEBUG --",
    status: "live",
    fathomEvent: "Product listing debug agents click",
  },
  {
    href: "/browser-tools",
    name: "Browser Tools SDK",
    tagline:
      "Browser tools for AI agents — open, inspect, and drive real browsers from any agent framework.",
    kicker: "// SDK --",
    status: "soon",
    fathomEvent: "Product listing browser tools click",
  },
];
