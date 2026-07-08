import { scopeSnapshotToRef } from "./capture-snapshot.js";
import type {
	Snapshot,
	SnapshotFrame,
	SnapshotNode,
	SnapshotPrimitive,
} from "./capture-snapshot.js";

const MAX_CHILDREN_PER_PARENT = 4;
const MAX_LABEL_CHARS = 140;
const MAX_SUMMARY_TEXT_CHARS = 80;
const MAX_HREF_CHARS = 96;
const MAX_ACTIONS_IN_SUMMARY = 3;
const MAX_ACTION_LABEL_CHARS = 80;

const PRESERVE_CHILDREN_BY_ROLE = new Set([
  "document",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "form",
  "search",
  "list",
  "table",
  "tabpanel",
]);

const FLATTEN_ROLES = new Set([
  "none",
  "presentation",
  "LayoutTable",
  "LayoutTableRow",
  "LayoutTableCell",
]);

const SKIP_ROLES = new Set(["InlineTextBox", "ListMarker"]);

const ACTION_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "slider",
]);

const ACTION_STATE_ATTRS = new Set([
  "checked",
  "disabled",
  "expanded",
  "pressed",
  "selected",
  "value",
  "placeholder",
]);

const TEXT_ACTION_ROLES = new Set(["button", "link", "menuitem", "tab"]);

const KEEP_ROLES = new Set([
  "document",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "form",
  "search",
  "list",
  "listitem",
  "button",
  "link",
  "image",
  "textbox",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menu",
  "menuitem",
  "option",
  "tab",
  "slider",
]);

const BLOCK_FLATTEN_ROLES = new Set([
  "paragraph",
  "section",
  "article",
  "region",
  "group",
  "figure",
]);

const RENDERED_STATE_PROPERTIES = [
  "disabled",
  "checked",
  "expanded",
  "selected",
  "pressed",
  "required",
  "invalid",
  "readonly",
  "multiline",
  "autocomplete",
  "haspopup",
  "value",
];

type SnapshotTextNode = {
  kind: "text";
  text: string;
  block?: boolean;
};

export type RenderedSnapshotNode = {
  kind: "node";
  key: string;
  role: string;
  attrs: Array<[string, string]>;
  children: RenderedSnapshotChild[];
};

export type RenderedSnapshotChild = RenderedSnapshotNode | SnapshotTextNode;

export type RenderedSnapshotFrame =
  | {
      status: "ok";
      id: string;
      index: number;
      url: string;
      name: string | null;
      parentId: string | null;
      roots: RenderedSnapshotNode[];
    }
  | {
      status: "unavailable";
      id: string;
      index: number;
      url: string;
      name: string | null;
      parentId: string | null;
      error: string;
    };

export function renderSnapshot(snapshot: Snapshot, refId?: string): string {
  const snapshotTree = refId ? scopeSnapshotToRef(snapshot, refId) : snapshot;
  const lines = [renderPageOpen(snapshotTree, "")];
  for (const frame of renderSnapshotFrames(snapshotTree)) {
    renderFrame(frame, 1, lines);
  }
  lines.push("</page>");
  return lines.join("\n");
}

export function renderSnapshotFrames(snapshot: Snapshot): RenderedSnapshotFrame[] {
  return snapshot.frames.map(toRenderedFrame).filter(hasRenderedFrameContent);
}

function renderPageOpen(
  snapshot: Pick<Snapshot, "title" | "url">,
  prefix: string,
  selfClosing = false,
): string {
  return `${prefix}${formatTag(
    "page",
    [
      ["title", firstNonEmpty(snapshot.title, snapshot.url) ?? ""],
      ["url", snapshot.url],
    ],
    !selfClosing,
  )}`;
}

function renderFrameLine(
  frame: RenderedSnapshotFrame,
  depth: number,
  prefix: string,
  selfClosing: boolean,
): string {
  const attrs: Array<[string, string]> = [
    ["index", String(frame.index)],
    ["url", normalizeText(frame.url, MAX_LABEL_CHARS)],
  ];
  if (frame.name)
    attrs.push(["name", normalizeText(frame.name, MAX_LABEL_CHARS)]);
  if (frame.parentId) attrs.push(["parent", frame.parentId]);
  if (frame.status === "unavailable") {
    attrs.push(["error", normalizeText(frame.error, 180)]);
  }
  return `${prefix}${indent(depth)}${formatTag("frame", attrs, !selfClosing)}`;
}

function renderTextNode(
  node: SnapshotTextNode,
  depth: number,
  prefix: string,
): string {
  return `${prefix}${indent(depth)}${escapeText(node.text)}`;
}

function indent(depth: number): string {
  return "\t".repeat(depth);
}

function formatTag(
  tagName: string,
  attributes: Array<[string, string]>,
  hasChildren: boolean,
): string {
  const attrs = attributes
    .filter(([, value]) => value !== "")
    .map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`)
    .join("");
  return hasChildren ? `<${tagName}${attrs}>` : `<${tagName}${attrs} />`;
}

export function renderChildrenTruncationNotice(
  children: RenderedSnapshotChild[],
): string {
  const count = children.length;
  const summaryActions = actionSummariesForChildren(children);
  const textSnippet = previewForChildren(children, summaryActions.labels);
  const elementLabel = count === 1 ? "element" : "elements";
  const textSnippetPart = textSnippet
    ? `. Text snippet: ${JSON.stringify(textSnippet)}`
    : "";
  const interactiveText = summaryActions.actions.length
    ? `. Interactive elements: ${summaryActions.actions
        .map((action) => action.markup)
        .join(", ")}${summaryActions.hasMore ? ", ..." : ""}`
    : "";
  return `[Truncated ${count} more ${elementLabel}${textSnippetPart}${interactiveText}]`;
}

function toRenderedFrame(frame: SnapshotFrame): RenderedSnapshotFrame {
  if (frame.status === "unavailable") return frame;
  return {
    status: "ok",
    id: frame.id,
    index: frame.index,
    url: frame.url,
    name: frame.name,
    parentId: frame.parentId,
    roots: frame.roots.flatMap((root) => toRenderedNodes(root, null)),
  };
}

function hasRenderedFrameContent(frame: RenderedSnapshotFrame): boolean {
  if (frame.status === "unavailable") return true;
  return frame.roots.length > 0;
}

function toRenderedNodes(
  node: SnapshotNode,
  parent: SnapshotNode | null,
): RenderedSnapshotNode[] {
  return toRenderedChildren(node, parent).filter(isRenderedNode);
}

function toRenderedChildren(
  node: SnapshotNode,
  parent: SnapshotNode | null,
): RenderedSnapshotChild[] {
  if (shouldSkipNode(node, parent)) return [];
  if (isTextRole(node.role)) {
    const text = firstNonEmpty(
      node.name,
      node.description,
      primitiveToString(node.value),
    );
    if (text && text !== parent?.name && text !== nodeTextValue(parent)) {
      return [{ kind: "text", text }];
    }
    return [];
  }

  const children = renderableChildren(node);
  const role = tagNameForRole(node.role);
  if (role === "heading") return renderHeading(node, children);

  const compactRole = roleForNode(node, role, children);
  if (compactRole === "image" && !hasNonEmptyAttribute(node, "src"))
    return [];
  if (compactRole === "link" && !hasNonEmptyAttribute(node, "href")) {
    return flattenedChildren(node, children).filter(
      hasVisibleTextOrInteractive,
    );
  }
  if (
    node.ignored ||
    FLATTEN_ROLES.has(node.role) ||
    !KEEP_ROLES.has(compactRole)
  ) {
    return flattenedChildren(node, children).filter(
      hasVisibleTextOrInteractive,
    );
  }

  const text = normalizedText(children);
  const suppressName = text.includes(normalizeRawText(node.name ?? ""))
    ? node.name
    : null;
  const attrs = nodeAttributes(node, suppressName);
  const content = nameAttributeAsContent(attrs, children);
  const renderedChildren = removeDuplicateNestedActions(
    compactRole,
    content.attrs,
    content.children,
  ).filter(hasVisibleTextOrInteractive);

  if (
    !ACTION_ROLES.has(compactRole) &&
    !renderedChildren.some(hasVisibleTextOrInteractive)
  ) {
    return [];
  }

  const rendered: RenderedSnapshotNode = {
    kind: "node",
    key:
      node.nodeId ||
      node.ref ||
      `${compactRole}:${content.attrs.map(([name, value]) => `${name}=${value}`).join(";")}`,
    role: compactRole,
    attrs: content.attrs,
    children: renderedChildren,
  };
  return [rendered];
}

function renderableChildren(node: SnapshotNode): RenderedSnapshotChild[] {
  const children: RenderedSnapshotChild[] = [];
  for (const child of node.children)
    children.push(...toRenderedChildren(child, node));
  return mergeAdjacentText(children).filter(hasVisibleTextOrInteractive);
}

function renderHeading(
  node: SnapshotNode,
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const text = firstNonEmpty(node.name, normalizedText(children));
  if (!text) return [];
  return [
    {
      kind: "text",
      text: `${"#".repeat(headingLevel(node))} ${text}`,
      block: true,
    },
  ];
}

function headingLevel(node: SnapshotNode): number {
  const rawLevel = node.properties.level;
  const level = typeof rawLevel === "number" ? rawLevel : Number(rawLevel);
  if (!Number.isFinite(level)) return 2;
  return Math.min(6, Math.max(1, Math.round(level)));
}

function roleForNode(
  node: SnapshotNode,
  role: string,
  children: RenderedSnapshotChild[],
): string {
  if (isPointerButtonCandidate(node, role, children)) return "button";
  return role;
}

function isPointerButtonCandidate(
  node: SnapshotNode,
  role: string,
  children: RenderedSnapshotChild[],
): boolean {
  if (KEEP_ROLES.has(role) && role !== "document") return false;
  if (children.some(hasInteractiveNode)) return false;
  if (!hasClickableHint(node)) return false;
  return Boolean(firstNonEmpty(node.name, normalizedText(children)));
}

function hasClickableHint(node: SnapshotNode): boolean {
  if (node.attributes.cursor === "pointer") return true;
  if (Object.hasOwn(node.attributes, "onclick")) return true;
  const tabindex = node.attributes.tabindex;
  return tabindex !== undefined && Number(tabindex) >= 0;
}

function hasInteractiveNode(child: RenderedSnapshotChild): boolean {
  if (child.kind === "text") return false;
  if (ACTION_ROLES.has(child.role)) return true;
  return child.children.some(hasInteractiveNode);
}

function flattenedChildren(
  node: SnapshotNode,
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const fallbackText = fallbackTextForFlattenedNode(node);
  const flattened =
    children.length > 0 || !fallbackText
      ? children
      : [{ kind: "text" as const, text: fallbackText }];

  if (!BLOCK_FLATTEN_ROLES.has(tagNameForRole(node.role))) return flattened;
  return flattened.map((child) =>
    child.kind === "text" ? { ...child, block: true } : child,
  );
}

function fallbackTextForFlattenedNode(node: SnapshotNode): string | null {
  const name = firstNonEmpty(node.name, primitiveToString(node.value));
  if (!name) return null;
  if (attributeMatchesName(node, "aria-label", name)) return null;
  if (attributeMatchesName(node, "title", name)) return null;
  if (attributeMatchesName(node, "alt", name)) return null;
  return name;
}

function attributeMatchesName(
  node: SnapshotNode,
  attributeName: string,
  name: string,
): boolean {
  return normalizeRawText(node.attributes[attributeName] ?? "") === name;
}

function hasNonEmptyAttribute(
  node: SnapshotNode,
  attributeName: string,
): boolean {
  return normalizeRawText(node.attributes[attributeName] ?? "") !== "";
}

function removeDuplicateNestedActions(
  role: string,
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  if (!ACTION_ROLES.has(role)) return children;
  const label = firstNonEmpty(
    attrFromAttrs(attrs, "name"),
    normalizedText(children),
  );
  if (!label) return children;

  return children.flatMap((child) => {
    if (child.kind === "text") return [child];
    if (!ACTION_ROLES.has(child.role)) return [child];
    const childLabel = firstNonEmpty(
      attrValue(child, "name"),
      singleTextChild(child),
      normalizedText(child.children),
    );
    return childLabel === label ? child.children : [child];
  });
}

function nameAttributeAsContent(
  attrs: Array<[string, string]>,
  children: RenderedSnapshotChild[],
): { attrs: Array<[string, string]>; children: RenderedSnapshotChild[] } {
  const name = attrFromAttrs(attrs, "name");
  if (!name) return { attrs, children };

  const attrsWithoutName = attrs.filter(([attr]) => attr !== "name");
  if (normalizedText(children).includes(normalizeRawText(name))) {
    return { attrs: attrsWithoutName, children };
  }

  return {
    attrs: attrsWithoutName,
    children: [{ kind: "text", text: name }, ...children],
  };
}

export function renderFrame(
  frame: RenderedSnapshotFrame,
  depth: number,
  lines: string[],
  prefix = "",
): void {
  if (frame.status === "unavailable") {
    lines.push(renderFrameLine(frame, depth, prefix, true));
    return;
  }

  lines.push(renderFrameLine(frame, depth, prefix, false));
  for (const root of frame.roots) renderNode(root, depth + 1, lines, prefix);
  lines.push(`${prefix}${indent(depth)}</frame>`);
}

export function renderNode(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  prefix = "",
): void {
  if (renderFoldedSingleChildChain(node, depth, lines, prefix)) return;

  if (node.children.length === 0) {
    lines.push(
      `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, false)}`,
    );
    return;
  }

  const singleText = singleTextChild(node);
  if (singleText !== null) {
    if (shouldRenderBareText(node)) {
      lines.push(`${prefix}${indent(depth)}${escapeText(singleText)}`);
      return;
    }

    lines.push(
      `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, true)}${escapeText(singleText)}</${node.role}>`,
    );
    return;
  }

  lines.push(
    `${prefix}${indent(depth)}${formatTag(node.role, node.attrs, true)}`,
  );
  renderChildren(node.children, depth + 1, lines, prefix);
  lines.push(`${prefix}${indent(depth)}</${node.role}>`);
}

function renderChildren(
  children: RenderedSnapshotChild[],
  depth: number,
  lines: string[],
  prefix: string,
): void {
  const renderedChildren = children.slice(0, MAX_CHILDREN_PER_PARENT);
  for (const child of renderedChildren) {
    if (child.kind === "text") {
      lines.push(`${prefix}${indent(depth)}${escapeText(child.text)}`);
      continue;
    }
    renderNode(child, depth, lines, prefix);
  }

  if (children.length > MAX_CHILDREN_PER_PARENT) {
    const truncated = children.slice(MAX_CHILDREN_PER_PARENT);
    lines.push(
      `${prefix}${indent(depth)}${renderChildrenTruncationNotice(
        truncated,
      )}`,
    );
  }
}

function renderFoldedSingleChildChain(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  prefix: string,
): boolean {
  const chain = singleChildChain(node);
  if (chain.length <= 1) return false;

  const keptIndexes = chain
    .map((chainNode, index) => ({ chainNode, index }))
    .filter(({ chainNode, index }) =>
      shouldKeepFoldedChainNode(chainNode, index),
    )
    .map(({ index }) => index);
  if (keptIndexes.length === chain.length) return false;

  renderFoldedChainNode(chain, keptIndexes, 0, depth, lines, prefix);
  return true;
}

function shouldKeepFoldedChainNode(
  node: RenderedSnapshotNode,
  index: number,
): boolean {
  return index === 0 || node.role === "list";
}

function renderFoldedChainNode(
  chain: RenderedSnapshotNode[],
  keptIndexes: number[],
  keptIndexPosition: number,
  depth: number,
  lines: string[],
  prefix: string,
): void {
  const currentIndex = keptIndexes[keptIndexPosition]!;
  const current = chain[currentIndex]!;
  lines.push(
    `${prefix}${indent(depth)}${formatTag(current.role, current.attrs, true)}`,
  );
  renderFoldedChainNodeOwnContent(current, depth + 1, lines, prefix);

  const nextKeptIndex = keptIndexes[keptIndexPosition + 1];
  if (nextKeptIndex !== undefined) {
    if (nextKeptIndex > currentIndex + 1)
      lines.push(`${prefix}${indent(depth + 1)}...`);
    renderFoldedChainNode(
      chain,
      keptIndexes,
      keptIndexPosition + 1,
      depth + 1,
      lines,
      prefix,
    );
  } else {
    const terminal = chain[chain.length - 1]!;
    if (chain.length - 1 > currentIndex)
      lines.push(`${prefix}${indent(depth + 1)}...`);
    renderChildren(terminal.children, depth + 1, lines, prefix);
  }

  lines.push(`${prefix}${indent(depth)}</${current.role}>`);
}

function renderFoldedChainNodeOwnContent(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
  prefix: string,
): void {
  for (const child of node.children) {
    if (child.kind === "text")
      lines.push(`${prefix}${indent(depth)}${escapeText(child.text)}`);
  }
}

function singleChildChain(node: RenderedSnapshotNode): RenderedSnapshotNode[] {
  const chain = [node];
  let current = node;

  while (isDeprioritizedSingleChildParent(current)) {
    const child = singleElementChild(current);
    if (!child) break;
    if (ACTION_ROLES.has(child.role)) break;
    chain.push(child);
    current = child;
  }

  return chain;
}

function isDeprioritizedSingleChildParent(node: RenderedSnapshotNode): boolean {
  if (node.role === "document") return false;
  if (ACTION_ROLES.has(node.role)) return false;
  return singleElementChild(node) !== null;
}

function singleElementChild(
  node: RenderedSnapshotNode,
): RenderedSnapshotNode | null {
  let result: RenderedSnapshotNode | null = null;
  for (const child of node.children) {
    if (child.kind === "text") continue;
    if (result) return null;
    result = child;
  }
  return result;
}

function shouldRenderBareText(node: RenderedSnapshotNode): boolean {
  if (ACTION_ROLES.has(node.role)) return false;
  if (attrValue(node, "ref")) return false;
  if (PRESERVE_CHILDREN_BY_ROLE.has(node.role)) return false;
  return true;
}

function nodeAttributes(
  node: SnapshotNode,
  suppressName: string | null,
): Array<[string, string]> {
  const attributes: Array<[string, string]> = [];
  const usedNames = new Set<string>();
  const push = (name: string, value: SnapshotPrimitive | undefined): void => {
    if (value === undefined || value === null || value === "") return;
    if (value === false || value === "false") return;
    const normalizedName = uniqueAttributeName(
      sanitizeAttributeName(name),
      usedNames,
    );
    attributes.push([
      normalizedName,
      normalizeAttributeValue(normalizedName, value),
    ]);
    usedNames.add(normalizedName);
  };

  push("ref", node.ref);
  if (node.name !== suppressName) push("name", node.name);

  const hasStateValue =
    node.properties.value !== undefined &&
    node.properties.value !== null &&
    node.properties.value !== "";
  for (const name of RENDERED_STATE_PROPERTIES) {
    const value = node.properties[name];
    if (value === true) push(name, "true");
    else push(name, value);
  }

  if (!hasStateValue) push("value", node.value);
  push("href", node.attributes.href);
  push("placeholder", node.attributes.placeholder);
  return attributes;
}

function normalizeAttributeValue(
  name: string,
  value: SnapshotPrimitive,
): string {
  const normalized = normalizeRawText(String(value));
  return name === "href" ? truncate(normalized, MAX_HREF_CHARS) : normalized;
}

function singleTextChild(node: RenderedSnapshotNode): string | null {
  if (node.children.length !== 1) return null;
  const child = node.children[0]!;
  return child.kind === "text" && !child.block ? child.text : null;
}

function mergeAdjacentText(
  children: RenderedSnapshotChild[],
): RenderedSnapshotChild[] {
  const result: RenderedSnapshotChild[] = [];
  for (const child of children) {
    const previous = result[result.length - 1];
    if (
      child.kind === "text" &&
      previous?.kind === "text" &&
      !child.block &&
      !previous.block
    ) {
      previous.text = normalizeRawText(`${previous.text} ${child.text}`);
    } else {
      result.push(child);
    }
  }
  return result;
}

function normalizedText(children: RenderedSnapshotChild[]): string {
  return children
    .map((child) =>
      child.kind === "text" ? child.text : normalizedText(child.children),
    )
    .join(" ");
}

function previewForChildren(
  children: RenderedSnapshotChild[],
  excludedText: Set<string>,
): string {
  const labels: string[] = [];
  const seen = new Set<string>();

  function visit(
    child: RenderedSnapshotChild,
    insideInteractive: boolean,
  ): void {
    if (child.kind === "text") {
      if (!insideInteractive) pushLabel(child.text);
      return;
    }

    const nextInsideInteractive =
      insideInteractive || ACTION_ROLES.has(child.role);
    if (labels.join(" · ").length > MAX_SUMMARY_TEXT_CHARS) return;
    for (const grandchild of child.children)
      visit(grandchild, nextInsideInteractive);
  }

  function pushLabel(value: string | null): void {
    const normalized = normalizeRawText(value ?? "");
    if (
      !normalized ||
      normalized === "no visible text" ||
      seen.has(normalized) ||
      excludedText.has(normalized)
    ) {
      return;
    }
    seen.add(normalized);
    labels.push(normalized);
  }

  for (const child of children) visit(child, false);
  const preview = labels.join(" · ");
  return preview ? truncate(preview, MAX_SUMMARY_TEXT_CHARS) : "";
}

function actionSummariesForChildren(children: RenderedSnapshotChild[]): {
  actions: Array<{ markup: string; label: string | null }>;
  labels: Set<string>;
  hasMore: boolean;
} {
  const actions: Array<{ markup: string; label: string | null }> = [];
  const labels = new Set<string>();
  const seenRefs = new Set<string>();
  let hasMore = false;

  function visit(child: RenderedSnapshotChild): void {
    if (child.kind === "text") return;

    const ref = attrValue(child, "ref");
    if (ref && ACTION_ROLES.has(child.role) && !seenRefs.has(ref)) {
      seenRefs.add(ref);
      const label = actionLabel(child);
      if (label) labels.add(label);
      if (actions.length < MAX_ACTIONS_IN_SUMMARY) {
        actions.push({ markup: renderActionSummary(child, ref), label });
      } else {
        hasMore = true;
      }
    }

    for (const grandchild of child.children) visit(grandchild);
  }

  for (const child of children) visit(child);
  return { actions, labels, hasMore };
}

function renderActionSummary(node: RenderedSnapshotNode, ref: string): string {
  const label = actionLabel(node);
  const attrs: Array<[string, string]> = [["ref", ref]];

  for (const [name, value] of node.attrs) {
    if (name === "ref" || !ACTION_STATE_ATTRS.has(name)) continue;
    attrs.push([name, normalizeText(value, MAX_ACTION_LABEL_CHARS)]);
  }

  if (!label || !TEXT_ACTION_ROLES.has(node.role)) {
    const name = attrValue(node, "name");
    if (name) attrs.push(["name", normalizeText(name, MAX_ACTION_LABEL_CHARS)]);
    return formatTag(node.role, attrs, false);
  }

  return `${formatTag(node.role, attrs, true)}${escapeText(
    normalizeText(label, MAX_ACTION_LABEL_CHARS),
  )}</${node.role}>`;
}

function actionLabel(node: RenderedSnapshotNode): string | null {
  return firstNonEmpty(
    singleTextChild(node),
    attrValue(node, "name"),
    attrValue(node, "value"),
    attrValue(node, "placeholder"),
  );
}

function attrValue(node: RenderedSnapshotNode, name: string): string | null {
  return node.attrs.find(([attr]) => attr === name)?.[1] ?? null;
}

function attrFromAttrs(
  attrs: Array<[string, string]>,
  name: string,
): string | null {
  return attrs.find(([attr]) => attr === name)?.[1] ?? null;
}

function shouldSkipNode(
  node: SnapshotNode,
  parent: SnapshotNode | null,
): boolean {
  if (SKIP_ROLES.has(node.role)) return true;
  if (node.role !== "StaticText") return false;
  return Boolean(parent?.name && node.name && parent.name === node.name);
}

function isTextRole(role: string): boolean {
  return role === "StaticText" || role === "InlineTextBox";
}

function isRenderedNode(
  child: RenderedSnapshotChild,
): child is RenderedSnapshotNode {
  return child.kind === "node";
}

function hasVisibleTextOrInteractive(child: RenderedSnapshotChild): boolean {
  if (child.kind === "text") return normalizeRawText(child.text) !== "";
  if (ACTION_ROLES.has(child.role)) return true;
  return child.children.some(hasVisibleTextOrInteractive);
}

function tagNameForRole(role: string): string {
  const normalized = normalizeRole(role).replace(/[^a-zA-Z0-9_.:-]/g, "-");
  return /^[a-zA-Z_:]/.test(normalized) ? normalized : "node";
}

function normalizeRole(role: string): string {
  if (role === "RootWebArea") return "document";
  if (role === "textField") return "textbox";
  return role || "node";
}

function primitiveToString(value: SnapshotPrimitive): string | null {
  return value === null ? null : String(value);
}

function nodeTextValue(node: SnapshotNode | null): string | null {
  if (!node) return null;
  const value = primitiveToString(node.properties.value ?? node.value);
  return value ? normalizeRawText(value) : null;
}

function firstNonEmpty(
  ...values: Array<string | null | undefined>
): string | null {
  for (const value of values) {
    const normalized = normalizeRawText(value ?? "");
    if (normalized) return truncate(normalized, MAX_LABEL_CHARS);
  }
  return null;
}

function normalizeText(value: string, maxChars: number): string {
  return truncate(value.replace(/\s+/g, " ").trim(), maxChars);
}

function normalizeRawText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string, maxChars: number): string {
  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}

function uniqueAttributeName(name: string, usedNames: Set<string>): string {
  if (!usedNames.has(name)) return name;
  let index = 2;
  while (usedNames.has(`${name}-${index}`)) index += 1;
  return `${name}-${index}`;
}

function sanitizeAttributeName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_.:-]/g, "-");
  return /^[a-zA-Z_:]/.test(sanitized) ? sanitized : `attr-${sanitized}`;
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
