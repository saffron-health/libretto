/**
 * Pure functions for building and flattening TocTreeNode[] from docs manifest
 * groups/pages and mdast headings.
 * Server-safe — no 'use client', no hooks, no browser APIs.
 */

import type { Heading, PhrasingContent, Root, RootContent } from "mdast";

export type TocNodeType = "group" | "page" | `h${1 | 2 | 3 | 4 | 5 | 6}`;
export type VisualLevel = 0 | 1 | 2 | 3;

export type TocTreeNode = {
  id: string;
  label: string;
  href: string;
  type: TocNodeType;
  children: TocTreeNode[];
};

export type FlatTocItem = {
  id: string;
  label: string;
  href: string;
  type: TocNodeType;
  visualLevel: VisualLevel;
  prefix: string;
  parentId: string | null;
};

export type TocManifestPage = {
  id: string;
  label: string;
  mdast: Root;
};

export type TocManifestGroup = {
  id: string;
  label: string;
  path: string;
  pages: TocManifestPage[];
};

type HeadingDescriptor = {
  id: string;
  label: string;
  href: string;
  depth: number;
};

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim();
}

export function extractText(children: PhrasingContent[]): string {
  return children
    .map((child) => {
      if ("value" in child && typeof child.value === "string") {
        return child.value;
      }
      if ("children" in child) {
        return extractText(child.children as PhrasingContent[]);
      }
      return "";
    })
    .join("");
}

function getHeadings(mdast: Root, headingIds?: WeakMap<Heading, string>): HeadingDescriptor[] {
  return mdast.children
    .filter((node): node is Heading => {
      return node.type === "heading";
    })
    .map((heading) => {
      const label = extractText(heading.children);
      const id = headingIds?.get(heading) ?? slugify(label);

      return {
        id,
        label,
        href: `#${id}`,
        depth: heading.depth,
      };
    });
}

export function generateTocTree(
  mdast: Root,
  headingIds?: WeakMap<Heading, string>,
  options?: { idPrefix?: string; hrefPrefix?: string },
): TocTreeNode[] {
  const headings = getHeadings(mdast, headingIds);
  const result: TocTreeNode[] = [];
  const stack: { node: TocTreeNode; depth: number }[] = [];
  const idPrefix = options?.idPrefix ?? "heading:";
  const hrefPrefix = options?.hrefPrefix ?? "";

  for (const heading of headings) {
    const node: TocTreeNode = {
      id: `${idPrefix}${heading.id}`,
      label: heading.label,
      href: `${hrefPrefix}${heading.href}`,
      type: `h${heading.depth}` as TocNodeType,
      children: [],
    };

    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop();
    }

    if (stack.length === 0) {
      result.push(node);
    } else {
      stack[stack.length - 1].node.children.push(node);
    }

    stack.push({ node, depth: heading.depth });
  }

  return result;
}

function withoutFirstHeading(mdast: Root): Root {
  let removedFirstHeading = false;

  return {
    type: "root",
    children: mdast.children.filter((node): node is RootContent => {
      if (!removedFirstHeading && node.type === "heading") {
        removedFirstHeading = true;
        return false;
      }

      return true;
    }),
  };
}

export function buildDocsTocTree({
  groups,
  headingIdsByGroup,
  currentGroupId,
}: {
  groups: TocManifestGroup[];
  headingIdsByGroup: Map<string, WeakMap<Heading, string>>;
  currentGroupId: string;
}): TocTreeNode[] {
  return groups.map((group) => {
    const groupHeadingIds = headingIdsByGroup.get(group.id);
    const pageNodes = group.pages.map((page) => {
      const pageHeadings = getHeadings(page.mdast, groupHeadingIds);
      const firstHeading = pageHeadings[0];
      const href =
        group.id === currentGroupId
          ? firstHeading?.href ?? group.path
          : `${group.path}${firstHeading?.href ?? ""}`;

      return {
        id: page.id,
        label: page.label,
        href,
        type: "page" as const,
        children:
          group.id === currentGroupId
            ? generateTocTree(withoutFirstHeading(page.mdast), groupHeadingIds, {
                idPrefix: `${page.id}:`,
              })
            : [],
      };
    });

    return {
      id: group.id,
      label: group.label,
      href: group.path,
      type: "group" as const,
      children: pageNodes,
    };
  });
}

function headingDepthFromType(type: TocNodeType): number | null {
  if (!type.startsWith("h")) {
    return null;
  }

  return Number.parseInt(type.slice(1), 10);
}

function hasNextSiblingAtLevel({
  items,
  index,
  level,
}: {
  items: FlatTocItem[];
  index: number;
  level: VisualLevel;
}): boolean {
  for (let i = index + 1; i < items.length; i++) {
    if (items[i].visualLevel < level) {
      return false;
    }
    if (items[i].visualLevel === level) {
      return true;
    }
  }

  return false;
}

function addPrefixes({ items }: { items: FlatTocItem[] }) {
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const isLast = !hasNextSiblingAtLevel({
      items,
      index: i,
      level: item.visualLevel,
    });

    if (item.visualLevel === 0) {
      item.prefix = "";
      continue;
    }

    item.prefix = `${"  ".repeat(Math.max(0, item.visualLevel - 1))}${isLast ? "└─ " : "├─ "}`;
  }
}

export function flattenTocTree({ roots }: { roots: TocTreeNode[] }): FlatTocItem[] {
  const result: FlatTocItem[] = [];

  function walk({
    nodes,
    parentId,
    parentVisualLevel,
    parentHeadingDepth,
  }: {
    nodes: TocTreeNode[];
    parentId: string | null;
    parentVisualLevel: number;
    parentHeadingDepth: number | null;
  }) {
    for (const node of nodes) {
      let nextVisualLevel = parentVisualLevel;
      let nextHeadingDepth = parentHeadingDepth;

      if (node.type === "group") {
        nextVisualLevel = parentId === null ? 0 : parentVisualLevel + 1;
        nextHeadingDepth = null;
      } else if (node.type === "page") {
        nextVisualLevel = parentVisualLevel + 1;
        nextHeadingDepth = 2;
      } else {
        const nodeHeadingDepth = headingDepthFromType(node.type) ?? 2;
        const depthDelta = nextHeadingDepth === null ? 1 : Math.max(1, nodeHeadingDepth - nextHeadingDepth);

        nextVisualLevel = parentVisualLevel + depthDelta;
        nextHeadingDepth = nodeHeadingDepth;
      }

      result.push({
        id: node.id,
        label: node.label,
        href: node.href,
        type: node.type,
        visualLevel: Math.min(nextVisualLevel, 3) as VisualLevel,
        prefix: "",
        parentId,
      });

      walk({
        nodes: node.children,
        parentId: node.id,
        parentVisualLevel: nextVisualLevel,
        parentHeadingDepth: nextHeadingDepth,
      });
    }
  }

  walk({
    nodes: roots,
    parentId: null,
    parentVisualLevel: 0,
    parentHeadingDepth: null,
  });

  addPrefixes({ items: result });
  return result;
}
