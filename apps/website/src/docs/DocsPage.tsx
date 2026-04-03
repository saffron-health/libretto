import { Fragment, type ReactNode, useEffect, useMemo } from "react";
import type { Heading, Image, Root, RootContent } from "mdast";
import { SafeMdxRenderer, type MyRootContent } from "safe-mdx";
import { mdxParse } from "safe-mdx/parse";
import { DISCUSSIONS_URL, RELEASES_URL, REPO_URL } from "../site";
import {
  A,
  Bleed,
  Blockquote,
  Caption,
  Card,
  CardGroup,
  Code,
  CodeBlock,
  CodeGroup,
  ComparisonTable,
  Columns,
  EditorialPage,
  Expandable,
  Note,
  FullWidth,
  Li,
  List,
  ParamField,
  OL,
  P,
  PixelatedImage,
  ResponseField,
  SectionHeading,
  Step,
  Steps,
  Tab,
  Tabs,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Tip,
  type EditorialSection,
  type HeadingLevel,
  type TabItem,
  Warning,
} from "./components/markdown";
import {
  buildDocsTocTree,
  extractText,
  flattenTocTree,
  slugify,
} from "./components/toc-tree";
import "./styles/docs.css";
import {
  docsManifest,
  getDefaultDocsGroup,
  getDocsGroupByPath,
} from "./content";

const tabItems = [
  { label: "Docs", href: "/docs/" },
  { label: "GitHub", href: REPO_URL },
  { label: "Forum", href: DISCUSSIONS_URL },
  { label: "Changelog", href: RELEASES_URL },
] satisfies TabItem[];

function isSidebarCalloutNode(node: RootContent): boolean {
  return (
    node.type === "mdxJsxFlowElement" &&
    "name" in node &&
    ["Note", "Tip", "Warning"].includes((node as { name?: string }).name ?? "")
  );
}

function isFullWidthNode(node: RootContent): boolean {
  return (
    node.type === "mdxJsxFlowElement" &&
    "name" in node &&
    (node as { name?: string }).name === "FullWidth"
  );
}

function isHeroNode(node: RootContent): boolean {
  return (
    node.type === "mdxJsxFlowElement" &&
    "name" in node &&
    (node as { name?: string }).name === "Hero"
  );
}

function hoistStepAsideCallouts(node: RootContent): {
  node: RootContent;
  asideNodes: RootContent[];
} {
  if (node.type !== "mdxJsxFlowElement") {
    return { node, asideNodes: [] };
  }

  const element = node as MdxFlowElement;
  const children = element.children;

  if (element.name === "Step") {
    const asideNodes = children.filter((child) => isSidebarCalloutNode(child));

    if (asideNodes.length === 0) {
      return { node, asideNodes: [] };
    }

    return {
      node: {
        ...element,
        children: children.filter(
          (child) => !isSidebarCalloutNode(child),
        ) as typeof children,
      },
      asideNodes,
    };
  }

  let changed = false;
  const asideNodes: RootContent[] = [];
  const nextChildren = children.map((child) => {
    const result = hoistStepAsideCallouts(child);
    changed ||= result.node !== child;
    asideNodes.push(...result.asideNodes);
    return result.node;
  }) as typeof children;

  if (!changed && asideNodes.length === 0) {
    return { node, asideNodes: [] };
  }

  return {
    node: {
      ...element,
      children: nextChildren,
    },
    asideNodes,
  };
}

type MdastSection = {
  contentNodes: RootContent[];
  asideNodes: RootContent[];
  fullWidth?: boolean;
};

type MdxFlowElement = Extract<RootContent, { type: "mdxJsxFlowElement" }>;

function buildHeadingIdMap(roots: Root[]): WeakMap<Heading, string> {
  const counts = new Map<string, number>();
  const headingIds = new WeakMap<Heading, string>();

  for (const root of roots) {
    for (const node of root.children) {
      if (node.type !== "heading") {
        continue;
      }

      const heading = node as Heading;
      const base = slugify(extractText(heading.children));
      const nextCount = counts.get(base) ?? 0;
      counts.set(base, nextCount + 1);

      headingIds.set(
        heading,
        nextCount === 0 ? base : `${base}-${nextCount}`,
      );
    }
  }

  return headingIds;
}

function groupBySections(root: Root): MdastSection[] {
  const sections: MdastSection[] = [];
  let current: MdastSection = { contentNodes: [], asideNodes: [] };

  for (const node of root.children) {
    if (node.type === "heading" && (node as Heading).depth === 2) {
      if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
        sections.push(current);
      }
      current = { contentNodes: [node], asideNodes: [] };
    } else if (isFullWidthNode(node)) {
      if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
        sections.push(current);
      }
      const children =
        "children" in node
          ? (node as { children: RootContent[] }).children
          : [];
      sections.push({
        contentNodes: children,
        asideNodes: [],
        fullWidth: true,
      });
      current = { contentNodes: [], asideNodes: [] };
    } else if (isSidebarCalloutNode(node)) {
      current.asideNodes.push(node);
    } else {
      const { node: normalizedNode, asideNodes } = hoistStepAsideCallouts(node);
      current.contentNodes.push(normalizedNode);
      current.asideNodes.push(...asideNodes);
    }
  }

  if (current.contentNodes.length > 0 || current.asideNodes.length > 0) {
    sections.push(current);
  }

  return sections;
}

const parsedDocsGroups = docsManifest.map((group) => {
  return {
    ...group,
    pages: group.pages.map((page) => {
      return {
        ...page,
        mdast: mdxParse(page.content) as Root,
      };
    }),
  };
});

const headingIdsByGroup = new Map(
  parsedDocsGroups.map((group) => {
    return [
      group.id,
      buildHeadingIdMap(
        group.pages.map((page) => {
          return page.mdast;
        }),
      ),
    ] as const;
  }),
);

function addHeadingTarget(
  lookup: Map<string, string[]>,
  id: string,
  target: string,
) {
  const existing = lookup.get(id);
  if (existing) {
    existing.push(target);
    return;
  }

  lookup.set(id, [target]);
}

const headingHrefLookup = (() => {
  const lookup = new Map<string, string[]>();

  for (const group of parsedDocsGroups) {
    addHeadingTarget(lookup, group.id, group.path);
    const groupHeadingIds = headingIdsByGroup.get(group.id);

    for (const page of group.pages) {
      for (const node of page.mdast.children) {
        if (node.type !== "heading") {
          continue;
        }

        const heading = node as Heading;
        const id =
          groupHeadingIds?.get(heading) ?? slugify(extractText(heading.children));
        addHeadingTarget(lookup, id, `${group.path}#${id}`);
      }
    }
  }

  return lookup;
})();

function PlainImage({
  src,
  alt,
  width,
  height,
  className,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  if (width && height) {
    return (
      <PixelatedImage
        src={src}
        alt={alt}
        width={width}
        height={height}
        className={className ?? ""}
      />
    );
  }

  return <img src={src} alt={alt} className={className} />;
}

function createMdxComponents(resolveHref: (href: string) => string) {
  return {
    p: P,
    a: ({ href, children }: { href: string; children: ReactNode }) => {
      return <A href={resolveHref(href)}>{children}</A>;
    },
    code: Code,
    ul: List,
    ol: OL,
    li: Li,
    Caption,
    ComparisonTable,
    PixelatedImage: PlainImage,
    Bleed,
    FullWidth,
    Note,
    Tip,
    Warning,
    Steps,
    Step,
    CardGroup,
    Card: ({
      title,
      href,
      children,
    }: {
      title: string;
      href: string;
      children: ReactNode;
    }) => {
      return (
        <Card title={title} href={resolveHref(href)}>
          {children}
        </Card>
      );
    },
    Columns,
    Tabs,
    Tab,
    CodeGroup,
    ParamField,
    ResponseField,
    Expandable,
    blockquote: Blockquote,
    table: Table,
    thead: THead,
    tbody: TBody,
    tr: TR,
    th: TH,
    td: TD,
    hr: () => (
      <div className="docs-divider">
        <div className="docs-divider-line" />
      </div>
    ),
  };
}

function stripMetaValue(raw: string): string {
  const unwrappedBraces = raw.replace(/^\{(.+)\}$/, "$1");

  if (
    (unwrappedBraces.startsWith('"') && unwrappedBraces.endsWith('"')) ||
    (unwrappedBraces.startsWith("'") && unwrappedBraces.endsWith("'"))
  ) {
    return unwrappedBraces.slice(1, -1);
  }

  return unwrappedBraces;
}

function parseBooleanMetaValue(raw: string): boolean | undefined {
  const value = stripMetaValue(raw).trim();

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function parseCodeBlockMeta(meta?: string): {
  title?: string;
  showLineNumbers?: boolean;
} {
  if (!meta?.trim()) {
    return {};
  }

  const tokens = meta.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [];
  let title: string | undefined;
  let showLineNumbers: boolean | undefined;

  for (const token of tokens) {
    const equalsIndex = token.indexOf("=");

    if (equalsIndex === -1) {
      title ??= stripMetaValue(token);
      continue;
    }

    const key = token.slice(0, equalsIndex);
    const value = token.slice(equalsIndex + 1);

    if (key === "title") {
      title = stripMetaValue(value);
    }

    if (key === "showLineNumbers") {
      showLineNumbers = parseBooleanMetaValue(value);
    }
  }

  return { title, showLineNumbers };
}

function renderNode(
  node: MyRootContent,
  transform: (candidate: MyRootContent) => ReactNode,
  headingIds: WeakMap<Heading, string>,
): ReactNode | undefined {
  if (node.type === "image") {
    const imageNode = node as Image;
    return <PlainImage src={imageNode.url} alt={imageNode.alt || ""} />;
  }

  if (node.type === "heading") {
    const heading = node as Heading;
    const id =
      headingIds.get(heading) ?? slugify(extractText(heading.children));
    const level = Math.min(Math.max(heading.depth, 1), 3) as HeadingLevel;

    return (
      <SectionHeading key={id} id={id} level={level}>
        {heading.children.map((child, index) => (
          <Fragment key={index}>{transform(child as MyRootContent)}</Fragment>
        ))}
      </SectionHeading>
    );
  }

  if (node.type === "code") {
    const codeNode = node as { lang?: string; value: string; meta?: string };
    const lang = codeNode.lang || "bash";
    const isDiagram = lang === "diagram";
    const { title, showLineNumbers } = parseCodeBlockMeta(codeNode.meta);

    return (
      <CodeBlock
        lang={lang}
        title={title}
        lineHeight={isDiagram ? "1.3" : "1.85"}
        showLineNumbers={isDiagram ? false : showLineNumbers}
      >
        {codeNode.value}
      </CodeBlock>
    );
  }

  return undefined;
}

function RenderNodes({
  nodes,
  markdown,
  components,
  headingIds,
}: {
  nodes: RootContent[];
  markdown: string;
  components: ReturnType<typeof createMdxComponents>;
  headingIds: WeakMap<Heading, string>;
}) {
  const syntheticRoot: Root = { type: "root", children: nodes };

  return (
    <SafeMdxRenderer
      markdown={markdown}
      mdast={syntheticRoot as MyRootContent}
      components={components}
      renderNode={(node, transform) => renderNode(node, transform, headingIds)}
    />
  );
}

export function DocsPage({ pathname }: { pathname?: string }) {
  const currentGroup =
    getDocsGroupByPath(pathname ?? window.location.pathname) ??
    getDefaultDocsGroup();
  const parsedCurrentGroup =
    parsedDocsGroups.find((group) => {
      return group.id === currentGroup.id;
    }) ?? parsedDocsGroups[0];
  const currentGroupHeadingIds = headingIdsByGroup.get(parsedCurrentGroup.id);

  if (!currentGroupHeadingIds) {
    throw new Error(`Missing heading ids for docs group ${parsedCurrentGroup.id}`);
  }

  const currentGroupMarkdown = parsedCurrentGroup.pages
    .map((page) => {
      return page.content;
    })
    .join("\n\n");
  const currentGroupAnchorIds = useMemo(() => {
    const ids = new Set<string>([parsedCurrentGroup.id]);

    for (const page of parsedCurrentGroup.pages) {
      for (const node of page.mdast.children) {
        if (node.type !== "heading") {
          continue;
        }

        const heading = node as Heading;
        ids.add(
          currentGroupHeadingIds.get(heading) ??
            slugify(extractText(heading.children)),
        );
      }
    }

    return ids;
  }, [parsedCurrentGroup, currentGroupHeadingIds]);

  const resolveDocsHref = useMemo(() => {
    return (href: string) => {
      if (/^(https?:)?\/\//.test(href)) {
        return href;
      }

      const anchor = href.startsWith("/docs/#")
        ? href.slice("/docs/#".length)
        : href.startsWith("#")
          ? href.slice(1)
          : null;

      if (anchor) {
        if (currentGroupAnchorIds.has(anchor)) {
          return `#${anchor}`;
        }

        const targets = headingHrefLookup.get(anchor);
        if (targets && targets.length > 0) {
          return targets[0];
        }
      }

      return href;
    };
  }, [currentGroupAnchorIds]);

  const mdxComponents = useMemo(() => {
    return createMdxComponents(resolveDocsHref);
  }, [resolveDocsHref]);

  const tocItems = flattenTocTree({
    roots: buildDocsTocTree({
      groups: parsedDocsGroups,
      headingIdsByGroup,
      currentGroupId: parsedCurrentGroup.id,
    }),
  });

  const sections: EditorialSection[] = [
    {
      content: (
        <div className="docs-group-heading-section">
          <SectionHeading id={parsedCurrentGroup.id} level={1}>
            {parsedCurrentGroup.label}
          </SectionHeading>
        </div>
      ),
    },
    ...parsedCurrentGroup.pages.flatMap((page) => {
      const contentMdast: Root = {
        type: "root",
        children: page.mdast.children.filter((node) => !isHeroNode(node)),
      };
      const pageSections = groupBySections(contentMdast);

      if (pageSections.length === 0) {
        throw new Error(`Missing docs sections for page ${page.id}`);
      }

      return pageSections.map((section) => {
        const aside =
          section.asideNodes.length > 0 ? (
            <RenderNodes
              nodes={section.asideNodes}
              markdown={currentGroupMarkdown}
              components={mdxComponents}
              headingIds={currentGroupHeadingIds}
            />
          ) : undefined;

        return {
          content: (
            <RenderNodes
              nodes={section.contentNodes}
              markdown={currentGroupMarkdown}
              components={mdxComponents}
              headingIds={currentGroupHeadingIds}
            />
          ),
          aside,
          fullWidth: section.fullWidth,
        } satisfies EditorialSection;
      });
    }),
  ];

  useEffect(() => {
    if (!window.location.hash) {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      return;
    }

    const targetId = window.location.hash.replace(/^#/, "");
    const scrollToTarget = () => {
      const target = document.getElementById(targetId);
      target?.scrollIntoView({ block: "start" });
    };

    window.requestAnimationFrame(scrollToTarget);
  }, [parsedCurrentGroup.id, pathname]);

  return (
    <div className="docs-root">
      <EditorialPage
        toc={tocItems}
        tabs={tabItems}
        activeTab="/docs/"
        sections={sections}
      />
    </div>
  );
}
