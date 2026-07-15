import type { Snapshot } from "./capture-snapshot.js";
import {
  renderChildrenTruncationNotice,
  renderFrame,
  renderNode,
  renderSnapshotFrames,
  type RenderedSnapshotChild,
  type RenderedSnapshotFrame,
  type RenderedSnapshotNode,
} from "./render-snapshot.js";

const MAX_DIFF_CHILDREN_PER_PARENT = 4;
const MAX_LABEL_CHARS = 140;

const LOW_SIGNAL_DIFF_ATTRS = new Set(["ref"]);

export type SnapshotDiff = {
  before: Snapshot;
  after: Snapshot;
  changed: boolean;
  pageChanged: boolean;
  frames: SnapshotFrameDiff[];
};

export type SnapshotFrameDiff =
  | {
      type: "context";
      frame: RenderedSnapshotFrame;
      children: SnapshotDiffChild[];
    }
  | {
      type: "modified";
      before: RenderedSnapshotFrame;
      after: RenderedSnapshotFrame;
    }
  | { type: "added"; frame: RenderedSnapshotFrame }
  | { type: "removed"; frame: RenderedSnapshotFrame };

export type SnapshotDiffChild = SnapshotNodeDiff | SnapshotTextDiff;

export type SnapshotNodeDiff =
  | {
      kind: "node";
      type: "context";
      node: RenderedSnapshotNode;
      children: SnapshotDiffChild[];
    }
  | {
      kind: "node";
      type: "modified";
      before: RenderedSnapshotNode;
      after: RenderedSnapshotNode;
      children: SnapshotDiffChild[];
    }
  | { kind: "node"; type: "added"; node: RenderedSnapshotNode }
  | { kind: "node"; type: "removed"; node: RenderedSnapshotNode };

export type SnapshotTextDiff =
  | {
      kind: "text";
      type: "modified";
      before: Extract<RenderedSnapshotChild, { kind: "text" }>;
      after: Extract<RenderedSnapshotChild, { kind: "text" }>;
    }
  | {
      kind: "text";
      type: "added";
      node: Extract<RenderedSnapshotChild, { kind: "text" }>;
    }
  | {
      kind: "text";
      type: "removed";
      node: Extract<RenderedSnapshotChild, { kind: "text" }>;
    };

export function diffSnapshots(before: Snapshot, after: Snapshot): SnapshotDiff {
  const beforeFrames = renderSnapshotFrames(before);
  const afterFrames = renderSnapshotFrames(after);
  const pageChanged = before.title !== after.title || before.url !== after.url;
  const frames = diffFrames(beforeFrames, afterFrames);
  return {
    before,
    after,
    pageChanged,
    frames,
    changed: pageChanged || frames.length > 0,
  };
}

export function renderSnapshotDiff(diff: SnapshotDiff): string {
  if (!diff.changed) return "";

  if (diff.pageChanged && diff.frames.length === 0) {
    return [
      renderPageOpen(diff.before, "- ", true),
      renderPageOpen(diff.after, "+ ", true),
    ].join("\n");
  }

  const lines = [renderPageOpen(diff.after, "")];
  for (const frameDiff of diff.frames) renderFrameDiff(frameDiff, 1, lines);
  lines.push("</page>");
  return lines.join("\n");
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
  node: Extract<RenderedSnapshotChild, { kind: "text" }>,
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

function diffFrames(
  beforeFrames: RenderedSnapshotFrame[],
  afterFrames: RenderedSnapshotFrame[],
): SnapshotFrameDiff[] {
  const diffs: SnapshotFrameDiff[] = [];
  const maxLength = Math.max(beforeFrames.length, afterFrames.length);

  for (let index = 0; index < maxLength; index += 1) {
    const before = beforeFrames[index];
    const after = afterFrames[index];
    if (before && !after) {
      diffs.push({ type: "removed", frame: before });
    } else if (!before && after) {
      diffs.push({ type: "added", frame: after });
    } else if (before && after) {
      const diff = diffFrame(before, after);
      if (diff) diffs.push(diff);
    }
  }

  return diffs;
}

function diffFrame(
  before: RenderedSnapshotFrame,
  after: RenderedSnapshotFrame,
): SnapshotFrameDiff | null {
  if (before.status !== after.status)
    return { type: "modified", before, after };
  if (before.status === "unavailable" || after.status === "unavailable") {
    return comparableFrame(before) === comparableFrame(after)
      ? null
      : { type: "modified", before, after };
  }

  const children = diffChildren(before.roots, after.roots);
  const frameChanged = comparableFrame(before) !== comparableFrame(after);
  if (!frameChanged && children.length === 0) return null;
  if (frameChanged && children.length === 0)
    return { type: "modified", before, after };
  return { type: "context", frame: after, children };
}

function diffChildren(
  beforeChildren: RenderedSnapshotChild[],
  afterChildren: RenderedSnapshotChild[],
): SnapshotDiffChild[] {
  const diffs: SnapshotDiffChild[] = [];
  const usedBefore = new Set<number>();

  for (let afterIndex = 0; afterIndex < afterChildren.length; afterIndex += 1) {
    const after = afterChildren[afterIndex]!;
    const beforeIndex = findMatchingBeforeChild(
      after,
      afterIndex,
      beforeChildren,
      usedBefore,
    );

    if (beforeIndex === -1) {
      diffs.push(addedChild(after));
      continue;
    }

    usedBefore.add(beforeIndex);
    const childDiff = diffChild(beforeChildren[beforeIndex]!, after);
    if (childDiff) diffs.push(childDiff);
  }

  for (
    let beforeIndex = 0;
    beforeIndex < beforeChildren.length;
    beforeIndex += 1
  ) {
    if (!usedBefore.has(beforeIndex))
      diffs.push(removedChild(beforeChildren[beforeIndex]!));
  }

  return diffs;
}

function diffChild(
  before: RenderedSnapshotChild,
  after: RenderedSnapshotChild,
): SnapshotDiffChild | null {
  if (before.kind === "text" || after.kind === "text") {
    if (before.kind === "text" && after.kind === "text") {
      return before.text === after.text
        ? null
        : { kind: "text", type: "modified", before, after };
    }
    return after.kind === "text" ? addedChild(after) : removedChild(before);
  }

  const children = diffChildren(before.children, after.children);
  const selfChanged = comparableNode(before) !== comparableNode(after);
  const directTextChanged = children.some((child) => child.kind === "text");
  if (!selfChanged && children.length === 0) return null;
  if (selfChanged || (sameRef(before, after) && directTextChanged)) {
    return { kind: "node", type: "modified", before, after, children };
  }
  return { kind: "node", type: "context", node: after, children };
}

function findMatchingBeforeChild(
  after: RenderedSnapshotChild,
  afterIndex: number,
  beforeChildren: RenderedSnapshotChild[],
  usedBefore: Set<number>,
): number {
  const beforeAtSameIndex = beforeChildren[afterIndex];
  if (
    beforeAtSameIndex &&
    !usedBefore.has(afterIndex) &&
    arePositionallySimilarChildren(beforeAtSameIndex, after)
  ) {
    return afterIndex;
  }

  if (after.kind === "node") {
    const byKey = beforeChildren.findIndex(
      (before, index) =>
        !usedBefore.has(index) &&
        before.kind === "node" &&
        before.key === after.key,
    );
    if (byKey !== -1) return byKey;

    const afterFingerprint = childFingerprint(after);
    const byFingerprint = beforeChildren.findIndex(
      (before, index) =>
        !usedBefore.has(index) &&
        before.kind === "node" &&
        childFingerprint(before) === afterFingerprint,
    );
    if (byFingerprint !== -1) return byFingerprint;
  }

  return -1;
}

function addedChild(child: RenderedSnapshotChild): SnapshotDiffChild {
  return child.kind === "text"
    ? { kind: "text", type: "added", node: child }
    : { kind: "node", type: "added", node: child };
}

function removedChild(child: RenderedSnapshotChild): SnapshotDiffChild {
  return child.kind === "text"
    ? { kind: "text", type: "removed", node: child }
    : { kind: "node", type: "removed", node: child };
}

function arePositionallySimilarChildren(
  before: RenderedSnapshotChild,
  after: RenderedSnapshotChild,
): boolean {
  if (before.kind !== after.kind) return false;
  if (before.kind === "text" && after.kind === "text") return true;
  if (before.kind === "node" && after.kind === "node") {
    return before.key === after.key || before.role === after.role;
  }
  return false;
}

function renderFrameDiff(
  diff: SnapshotFrameDiff,
  depth: number,
  lines: string[],
): void {
  if (diff.type === "added") {
    renderFrame(diff.frame, depth, lines, "+ ");
  } else if (diff.type === "removed") {
    renderFrame(diff.frame, depth, lines, "- ");
  } else if (diff.type === "modified") {
    renderFrame(diff.before, depth, lines, "- ");
    renderFrame(diff.after, depth, lines, "+ ");
  } else if (diff.frame.status === "ok") {
    lines.push(renderFrameLine(diff.frame, depth, "", false));
    if (
      diff.frame.roots.length > diff.children.length &&
      diff.children.length > 0
    ) {
      lines.push(`${indent(depth + 1)}...`);
    }
    renderChildDiffs(diff.children, depth + 1, lines);
    lines.push(`${indent(depth)}</frame>`);
  }
}

function renderChildDiffs(
  diffs: SnapshotDiffChild[],
  depth: number,
  lines: string[],
): void {
  for (const diff of diffs.slice(0, MAX_DIFF_CHILDREN_PER_PARENT)) {
    renderChildDiff(diff, depth, lines);
  }

  if (diffs.length > MAX_DIFF_CHILDREN_PER_PARENT) {
    const truncated = diffs.slice(MAX_DIFF_CHILDREN_PER_PARENT);
    const prefix = diffPrefixForSummary(truncated);
    lines.push(
      `${prefix}${indent(depth)}${renderChildrenTruncationNotice(
        diffSummaryChildren(truncated),
      )}`,
    );
  }
}

function renderChildDiff(
  diff: SnapshotDiffChild,
  depth: number,
  lines: string[],
): void {
  if (diff.kind === "text") {
    if (diff.type === "added")
      lines.push(renderTextNode(diff.node, depth, "+ "));
    else if (diff.type === "removed")
      lines.push(renderTextNode(diff.node, depth, "- "));
    else {
      lines.push(renderTextNode(diff.before, depth, "- "));
      lines.push(renderTextNode(diff.after, depth, "+ "));
    }
    return;
  }

  renderNodeDiff(diff, depth, lines);
}

function renderNodeDiff(
  diff: SnapshotNodeDiff,
  depth: number,
  lines: string[],
): void {
  if (diff.type === "added") {
    renderNode(diff.node, depth, lines, "+ ");
  } else if (diff.type === "removed") {
    renderRemovedNode(diff.node, depth, lines);
  } else if (diff.type === "modified") {
    if (sameRef(diff.before, diff.after)) {
      renderModifiedSameRefNode(diff, depth, lines);
    } else {
      renderRemovedNode(diff.before, depth, lines);
      renderNode(diff.after, depth, lines, "+ ");
    }
  } else {
    if (diff.node.children.length === 0) {
      lines.push(
        `${indent(depth)}${formatTag(diff.node.role, diff.node.attrs, false)}`,
      );
      return;
    }

    lines.push(
      `${indent(depth)}${formatTag(diff.node.role, diff.node.attrs, true)}`,
    );
    if (diff.node.children.length > diff.children.length)
      lines.push(`${indent(depth + 1)}...`);
    renderChildDiffs(diff.children, depth + 1, lines);
    lines.push(`${indent(depth)}</${diff.node.role}>`);
  }
}

function renderModifiedSameRefNode(
  diff: Extract<SnapshotNodeDiff, { type: "modified" }>,
  depth: number,
  lines: string[],
): void {
  if (diff.children.length === 0 || singleTextChild(diff.after) !== null) {
    renderNode(diff.after, depth, lines, "~ ");
    return;
  }

  if (diff.after.children.length === 0) {
    lines.push(
      `~ ${indent(depth)}${formatTag(diff.after.role, diff.after.attrs, false)}`,
    );
    return;
  }

  lines.push(
    `~ ${indent(depth)}${formatTag(diff.after.role, diff.after.attrs, true)}`,
  );
  if (diff.after.children.length > diff.children.length)
    lines.push(`~ ${indent(depth + 1)}...`);
  renderChildDiffs(diff.children, depth + 1, lines);
  lines.push(`~ ${indent(depth)}</${diff.after.role}>`);
}

function renderRemovedNode(
  node: RenderedSnapshotNode,
  depth: number,
  lines: string[],
): void {
  const attrs = node.attrs.filter(([name]) => name === "ref");
  if (node.children.length === 0) {
    lines.push(`- ${indent(depth)}${formatTag(node.role, attrs, false)}`);
    return;
  }

  lines.push(
    `- ${indent(depth)}${formatTag(node.role, attrs, true)}...</${node.role}>`,
  );
}

function comparableFrame(frame: RenderedSnapshotFrame): string {
  return JSON.stringify({
    status: frame.status,
    id: frame.id,
    index: frame.index,
    url: frame.url,
    name: frame.name,
    parentId: frame.parentId,
    error: frame.status === "unavailable" ? frame.error : undefined,
  });
}

function comparableNode(node: RenderedSnapshotNode): string {
  return JSON.stringify({
    role: node.role,
    attrs: comparableAttrs(node.attrs),
  });
}

function comparableAttrs(
  attrs: Array<[string, string]>,
): Array<[string, string]> {
  return attrs.flatMap(([name, value]) => {
    if (LOW_SIGNAL_DIFF_ATTRS.has(name)) return [];
    if (name === "href") return [[name, normalizeComparableHref(value)]];
    return [[name, value]];
  });
}

function sameRef(
  before: RenderedSnapshotNode,
  after: RenderedSnapshotNode,
): boolean {
  const beforeRef = attrValue(before, "ref");
  return beforeRef !== null && beforeRef === attrValue(after, "ref");
}

function attrValue(node: RenderedSnapshotNode, name: string): string | null {
  return node.attrs.find(([attr]) => attr === name)?.[1] ?? null;
}

function singleTextChild(node: RenderedSnapshotNode): string | null {
  if (node.children.length !== 1) return null;
  const child = node.children[0]!;
  return child.kind === "text" && !child.block ? child.text : null;
}

function childFingerprint(child: RenderedSnapshotChild): string {
  if (child.kind === "text") return `text:${child.text}`;
  return comparableNode(child);
}

function normalizeComparableHref(value: string): string {
  const withoutEllipsis = value.endsWith("…") ? value.slice(0, -1) : value;
  try {
    const url = new URL(withoutEllipsis);
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return withoutEllipsis.split(/[?#]/, 1)[0] ?? withoutEllipsis;
  }
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
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

function diffPrefixForSummary(diffs: SnapshotDiffChild[]): string {
  if (diffs.every((diff) => diff.type === "added")) return "+ ";
  if (diffs.every((diff) => diff.type === "removed")) return "- ";
  return "";
}

function diffSummaryChildren(
  diffs: SnapshotDiffChild[],
): RenderedSnapshotChild[] {
  return diffs.map((diff) =>
    diff.type === "modified" ? diff.after : diff.node,
  );
}
