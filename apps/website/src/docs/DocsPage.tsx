import { Fragment, type ReactNode } from "react";
import type { Heading, Image, Root, RootContent } from "mdast";
import { SafeMdxRenderer, type MyRootContent } from "safe-mdx";
import { mdxParse } from "safe-mdx/parse";
import { DISCUSSIONS_URL, RELEASES_URL, REPO_URL } from "../site";
import {
  A,
  Aside,
  Accordion,
  AccordionGroup,
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
import { docsManifest, docsMdxContent } from "./content";

const tabItems = [
  { label: "Docs", href: "/docs/" },
  { label: "GitHub", href: REPO_URL },
  { label: "Forum", href: DISCUSSIONS_URL },
  { label: "Changelog", href: RELEASES_URL },
] satisfies TabItem[];

function isAsideNode(node: RootContent): boolean {
  return (
    node.type === "mdxJsxFlowElement" &&
    "name" in node &&
    (node as { name?: string }).name === "Aside"
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

type MdastSection = {
  contentNodes: RootContent[];
  asideNodes: RootContent[];
  fullWidth?: boolean;
};

function getSectionHref(
  section: MdastSection,
  headingIds: WeakMap<Heading, string>,
): string | null {
  const heading = section.contentNodes.find((node): node is Heading => {
    return node.type === "heading" && (node as Heading).depth === 2;
  });

  if (!heading) {
    return null;
  }

  return `#${headingIds.get(heading) ?? slugify(extractText(heading.children))}`;
}

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
        nextCount === 0 ? base : `${base}-${nextCount + 1}`,
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
    } else if (isAsideNode(node)) {
      current.asideNodes.push(node);
    } else {
      current.contentNodes.push(node);
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

const pageMdasts = parsedDocsGroups.flatMap((group) => {
  return group.pages.map((page) => {
    return page.mdast;
  });
});

const mdast: Root = {
  type: "root",
  children: pageMdasts.flatMap((pageMdast) => {
    return pageMdast.children;
  }),
};

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

const mdxComponents = {
  p: P,
  a: A,
  code: Code,
  ul: List,
  ol: OL,
  li: Li,
  Caption,
  ComparisonTable,
  PixelatedImage: PlainImage,
  Bleed,
  Aside,
  FullWidth,
  Note,
  Tip,
  Warning,
  Steps,
  Step,
  CardGroup,
  Card,
  Columns,
  Tabs,
  Tab,
  CodeGroup,
  ParamField,
  ResponseField,
  AccordionGroup,
  Accordion,
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
    const title = codeNode.meta
      ?.trim()
      .split(/\s+/)
      .find((part) => !part.includes("=") && !part.includes("{"));

    return (
      <CodeBlock
        lang={lang}
        title={title}
        lineHeight={isDiagram ? "1.3" : "1.85"}
        showLineNumbers={!isDiagram}
      >
        {codeNode.value}
      </CodeBlock>
    );
  }

  return undefined;
}

function RenderNodes({
  nodes,
  headingIds,
}: {
  nodes: RootContent[];
  headingIds: WeakMap<Heading, string>;
}) {
  const syntheticRoot: Root = { type: "root", children: nodes };

  return (
    <SafeMdxRenderer
      markdown={docsMdxContent}
      mdast={syntheticRoot as MyRootContent}
      components={mdxComponents}
      renderNode={(node, transform) => renderNode(node, transform, headingIds)}
    />
  );
}

export function DocsPage() {
  const contentChildren = mdast.children.filter((node) => !isHeroNode(node));
  const contentMdast: Root = { type: "root", children: contentChildren };
  const headingIds = buildHeadingIdMap(pageMdasts);

  const tocItems = flattenTocTree({
    roots: buildDocsTocTree({ groups: parsedDocsGroups, headingIds }),
  });
  const mdastSections = groupBySections(contentMdast);
  const sectionByHref = new Map(
    mdastSections
      .map((section) => {
        const href = getSectionHref(section, headingIds);
        return href ? ([href, section] as const) : null;
      })
      .filter(
        (entry): entry is readonly [string, MdastSection] => entry !== null,
      ),
  );

  const sections: EditorialSection[] = parsedDocsGroups.flatMap((group) => {
    const groupHeadingSection: EditorialSection = {
      content: (
        <div className="docs-group-heading-section">
          <SectionHeading id={group.id} level={1}>
            {group.label}
          </SectionHeading>
        </div>
      ),
    };

    const groupSections = group.pages.map((page) => {
      const firstPageHeading = page.mdast.children.find(
        (node): node is Heading => {
          return node.type === "heading";
        },
      );

      if (!firstPageHeading) {
        throw new Error(`Missing top-level heading for docs page ${page.id}`);
      }

      const pageHref = `#${headingIds.get(firstPageHeading) ?? slugify(extractText(firstPageHeading.children))}`;
      const section = sectionByHref.get(pageHref);

      if (!section) {
        throw new Error(`Missing docs page section for ${pageHref}`);
      }

      const aside =
        section.asideNodes.length > 0 ? (
          <RenderNodes nodes={section.asideNodes} headingIds={headingIds} />
        ) : undefined;

      return {
        content: (
          <RenderNodes nodes={section.contentNodes} headingIds={headingIds} />
        ),
        aside,
        fullWidth: section.fullWidth,
      } satisfies EditorialSection;
    });

    return [groupHeadingSection, ...groupSections];
  });

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
