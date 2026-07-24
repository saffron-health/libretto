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
    href: "/chrome-extension",
    name: "Chrome Extension",
    tagline:
      "Tell an agent what you need done in Chrome, then save it as a workflow you can run again or schedule in the cloud.",
    kicker: "// BROWSER EXTENSION --",
    status: "live",
    fathomEvent: "Product listing chrome extension click",
  },
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
      "Six tools that let AI agents read pages and control real browsers with Playwright.",
    kicker: "// SDK --",
    status: "live",
    fathomEvent: "Product listing browser tools click",
  },
];
