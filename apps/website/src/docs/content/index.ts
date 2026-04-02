// Old docs page code. The inline MDX content that used to live here was removed
// because the canonical docs now live in the root docs/ folder (Mintlify).
// To get this website docs page working again, re-wire the imports and manifest
// below to read from docs/ instead of the deleted pages/ directory.

export type DocsContentPage = {
  id: string;
  label: string;
  content: string;
};

export type DocsContentGroup = {
  id: string;
  label: string;
  path: string;
  pages: DocsContentPage[];
};

export const docsManifest: DocsContentGroup[] = [];

export function normalizeDocsPath(pathname: string): string {
  if (pathname === "/" || pathname.length === 0) {
    return pathname;
  }

  return pathname.replace(/\/+$/, "");
}

export function getDefaultDocsGroup(): DocsContentGroup | undefined {
  return docsManifest[0];
}

export function getDocsGroupByPath(
  pathname: string,
): DocsContentGroup | undefined {
  const normalizedPath = normalizeDocsPath(pathname);

  if (normalizedPath === "/docs" || normalizedPath === "/docs/index.html") {
    return getDefaultDocsGroup();
  }

  return docsManifest.find((group) => {
    return group.path === normalizedPath;
  });
}
