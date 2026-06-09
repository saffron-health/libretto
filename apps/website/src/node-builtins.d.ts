declare module "node:fs/promises" {
  export function readdir(path: string | URL): Promise<string[]>;
  export function readFile(path: string | URL, encoding: "utf8"): Promise<string>;
}

declare module "node:path" {
  export function basename(path: string, suffix?: string): string;
  export function extname(path: string): string;
  export function join(...paths: string[]): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}
