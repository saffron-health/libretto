import type { CDPSession, Page } from "playwright";

export type SnapshotPrimitive = string | number | boolean | null;

export type Snapshot = {
	title: string;
	url: string;
	frames: SnapshotFrame[];
};

export type SnapshotFrame = SnapshotAvailableFrame | SnapshotUnavailableFrame;

export type SnapshotAvailableFrame = {
	status: "ok";
	id: string;
	index: number;
	url: string;
	name: string | null;
	parentId: string | null;
	roots: SnapshotNode[];
};

export type SnapshotUnavailableFrame = {
	status: "unavailable";
	id: string;
	index: number;
	url: string;
	name: string | null;
	parentId: string | null;
	error: string;
};

export type SnapshotNode = {
	nodeId: string;
	ignored: boolean;
	role: string;
	name: string | null;
	value: SnapshotPrimitive;
	description: string | null;
	properties: Record<string, SnapshotPrimitive>;
	attributes: Record<string, string>;
	children: SnapshotNode[];
	ref: string | null;
	subtreeSize: number;
};

const MAX_ATTRIBUTE_NODE_LOOKUPS = 300;

const REFS_BY_ROLE = new Set([
  "RootWebArea",
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "form",
  "search",
  "article",
  "section",
  "region",
  "heading",
  "button",
  "link",
  "textbox",
  "textField",
  "checkbox",
  "radio",
  "switch",
  "combobox",
  "listbox",
  "menuitem",
  "tab",
  "slider",
]);

const INTERESTING_ATTRIBUTES = new Set([
  "data-testid",
  "data-test",
  "data-qa",
  "data-cy",
  "id",
  "name",
  "type",
  "placeholder",
  "href",
  "src",
  "aria-label",
  "aria-expanded",
  "aria-pressed",
  "aria-selected",
  "aria-checked",
  "role",
  "title",
  "alt",
  "onclick",
  "tabindex",
]);

const STATE_PROPERTY_NAMES = [
  "level",
  "disabled",
  "checked",
  "expanded",
  "selected",
  "pressed",
  "focused",
  "required",
  "invalid",
  "readonly",
  "multiline",
  "autocomplete",
  "haspopup",
  "value",
];

type RawAxProperty = {
  name: string;
  value: SnapshotPrimitive;
};

type RawAxNode = {
  nodeId: string;
  parentId: string | null;
  ignored: boolean;
  role: string;
  name: string | null;
  value: SnapshotPrimitive;
  description: string | null;
  properties: RawAxProperty[];
  childIds: string[];
  backendDOMNodeId: number | null;
};

type MutableSnapshotNode = Omit<SnapshotNode, "children"> & {
  childIds: string[];
  children: MutableSnapshotNode[];
  parent: MutableSnapshotNode | null;
};

type FrameInfo = {
  id: string;
  url: string;
  name: string | null;
  parentId: string | null;
};

export async function snapshot(page: Page): Promise<Snapshot> {
  const cdp = await page.context().newCDPSession(page);

  try {
    await enableIfSupported(cdp, "DOM.enable");
    await enableIfSupported(cdp, "Accessibility.enable");
    await enableIfSupported(cdp, "Runtime.enable");

    const [title, frames] = await Promise.all([
      page.title().catch(() => ""),
      getFrameInfos(cdp),
    ]);

    const snapshotFrames: Snapshot["frames"] = [];
    let nextRef = 1;
    for (const [index, frame] of frames.entries()) {
      const frameSnapshot = await captureFrameSnapshot(cdp, frame, index);
      if (frameSnapshot.ok) {
        nextRef = assignRefs(frameSnapshot.roots, nextRef);
        snapshotFrames.push({
          status: "ok",
          id: frame.id,
          index,
          url: frame.url,
          name: frame.name,
          parentId: frame.parentId,
          roots: frameSnapshot.roots.map(toSnapshotNode),
        });
      } else {
        snapshotFrames.push({
          status: "unavailable",
          id: frame.id,
          index,
          url: frame.url,
          name: frame.name,
          parentId: frame.parentId,
          error: frameSnapshot.error,
        });
      }
    }

    return { title, url: page.url(), frames: snapshotFrames };
  } finally {
    await cdp.detach().catch(() => {});
  }
}

export function findSnapshotNodeByRef(
  snapshotTree: Snapshot,
  ref: string,
): SnapshotNode {
  const normalizedRef = normalizeRequestedRef(ref);
  const matchingNode = findNodeByRef(snapshotTree, normalizedRef);
  if (!matchingNode) {
    throw new Error(`Snapshot ref "${ref}" was not found.`);
  }
  return matchingNode;
}

export function scopeSnapshotToRef(
  snapshotTree: Snapshot,
  ref: string,
): Snapshot {
  const matchingNode = findSnapshotNodeByRef(snapshotTree, ref);

  return {
    ...snapshotTree,
    frames: snapshotTree.frames.flatMap((frame) => {
      if (frame.status !== "ok") return [];
      if (!frameContainsNode(frame.roots, matchingNode)) return [];
      return [{ ...frame, roots: [matchingNode] }];
    }),
  };
}

function normalizeRequestedRef(ref: string): string {
  return ref.trim();
}

function findNodeByRef(
  snapshotTree: Snapshot,
  ref: string,
): SnapshotNode | null {
  const exact = findNode(snapshotTree, (node) => node.ref === ref);
  if (exact) return exact;

  const numericSuffix = ref.match(/^[a-zA-Z]+(\d+)$/)?.[1];
  if (!numericSuffix) return null;
  return findNode(
    snapshotTree,
    (node) => node.ref?.match(/^[a-zA-Z]+(\d+)$/)?.[1] === numericSuffix,
  );
}

function findNode(
  snapshotTree: Snapshot,
  predicate: (node: SnapshotNode) => boolean,
): SnapshotNode | null {
  for (const frame of snapshotTree.frames) {
    if (frame.status !== "ok") continue;
    for (const root of frame.roots) {
      const node = findNodeInTree(root, predicate);
      if (node) return node;
    }
  }
  return null;
}

function findNodeInTree(
  node: SnapshotNode,
  predicate: (node: SnapshotNode) => boolean,
): SnapshotNode | null {
  if (predicate(node)) return node;
  for (const child of node.children) {
    const match = findNodeInTree(child, predicate);
    if (match) return match;
  }
  return null;
}

function frameContainsNode(
  roots: SnapshotNode[],
  target: SnapshotNode,
): boolean {
  return roots.some((root) => findNodeInTree(root, (node) => node === target));
}

async function enableIfSupported(
  cdp: CDPSession,
  method: "DOM.enable" | "Accessibility.enable" | "Runtime.enable",
): Promise<void> {
  try {
    await cdp.send(method);
  } catch {
    // Some Chromium targets do not support every domain for every frame target.
  }
}

async function captureFrameSnapshot(
  cdp: CDPSession,
  frame: FrameInfo,
  frameIndex: number,
): Promise<
  { ok: true; roots: MutableSnapshotNode[] } | { ok: false; error: string }
> {
  try {
    const response = await cdp.send("Accessibility.getFullAXTree", {
      frameId: frame.id,
    });
    const rawNodes = parseAxNodes(response as unknown);
    const attributeMap = await readAttributesByBackendNodeId(cdp, rawNodes);
    return { ok: true, roots: buildSnapshotTree(rawNodes, attributeMap) };
  } catch (error) {
    if (frameIndex !== 0) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }

    try {
      const response = await cdp.send("Accessibility.getFullAXTree");
      const rawNodes = parseAxNodes(response as unknown);
      const attributeMap = await readAttributesByBackendNodeId(cdp, rawNodes);
      return { ok: true, roots: buildSnapshotTree(rawNodes, attributeMap) };
    } catch (fallbackError) {
      return {
        ok: false,
        error:
          fallbackError instanceof Error
            ? fallbackError.message
            : String(fallbackError),
      };
    }
  }
}

async function getFrameInfos(cdp: CDPSession): Promise<FrameInfo[]> {
  try {
    const response = (await cdp.send("Page.getFrameTree")) as unknown;
    const frames = parseFrameTree(response);
    return frames.length > 0
      ? frames
      : [{ id: "main", url: "", name: null, parentId: null }];
  } catch {
    return [{ id: "main", url: "", name: null, parentId: null }];
  }
}

function parseFrameTree(response: unknown): FrameInfo[] {
  const root = readRecord(response).frameTree;
  const frames: FrameInfo[] = [];

  function visit(value: unknown, inheritedParentId: string | null): void {
    const tree = readRecord(value);
    const frame = readRecord(tree.frame);
    const id = readString(frame.id);
    if (!id) return;

    frames.push({
      id,
      url: readString(frame.url) ?? "",
      name: readString(frame.name),
      parentId: readString(frame.parentId) ?? inheritedParentId,
    });

    const childFrames = Array.isArray(tree.childFrames) ? tree.childFrames : [];
    for (const child of childFrames) visit(child, id);
  }

  visit(root, null);
  return frames;
}

function parseAxNodes(response: unknown): RawAxNode[] {
  const nodes = readRecord(response).nodes;
  if (!Array.isArray(nodes)) return [];
  return nodes.map(parseAxNode);
}

function parseAxNode(value: unknown): RawAxNode {
  const record = readRecord(value);
  const nodeId = readString(record.nodeId) ?? "";
  const childIds = Array.isArray(record.childIds)
    ? record.childIds.map(readString).filter((id): id is string => id !== null)
    : [];

  return {
    nodeId,
    parentId: readString(record.parentId),
    ignored: readBoolean(record.ignored) ?? false,
    role: readAxValueString(record.role) ?? "unknown",
    name: readAxValueString(record.name),
    value: readAxPrimitive(record.value),
    description: readAxValueString(record.description),
    properties: parseAxProperties(record.properties),
    childIds,
    backendDOMNodeId: readNumber(record.backendDOMNodeId),
  };
}

function parseAxProperties(value: unknown): RawAxProperty[] {
  if (!Array.isArray(value)) return [];
  const properties: RawAxProperty[] = [];
  for (const item of value) {
    const record = readRecord(item);
    const name = readString(record.name);
    if (!name) continue;
    properties.push({ name, value: readAxPrimitive(record.value) });
  }
  return properties;
}

async function readAttributesByBackendNodeId(
  cdp: CDPSession,
  nodes: RawAxNode[],
): Promise<Map<number, Record<string, string>>> {
  const backendNodeIds = unique(
    nodes
      .filter(shouldReadAttributes)
      .sort((a, b) => attributeLookupPriority(a) - attributeLookupPriority(b))
      .map((node) => node.backendDOMNodeId)
      .filter((id): id is number => id !== null),
  ).slice(0, MAX_ATTRIBUTE_NODE_LOOKUPS);

  const result = new Map<number, Record<string, string>>();
  await Promise.all(
    backendNodeIds.map(async (backendNodeId) => {
      const attributes = await readAttributesForBackendNodeId(
        cdp,
        backendNodeId,
      );
      if (Object.keys(attributes).length > 0) {
        result.set(backendNodeId, attributes);
      }
    }),
  );
  return result;
}

function shouldReadAttributes(node: RawAxNode): boolean {
  if (node.ignored) return false;
  if (node.backendDOMNodeId === null) return false;
  if (REFS_BY_ROLE.has(node.role)) return true;
  if (node.role === "generic" || node.role === "group") return true;
  if (node.name && node.name.trim().length > 0) return true;
  return node.properties.some((property) =>
    STATE_PROPERTY_NAMES.includes(property.name),
  );
}

function attributeLookupPriority(node: RawAxNode): number {
  if (REFS_BY_ROLE.has(node.role)) return 0;
  if (node.name && node.name.trim().length > 0) return 1;
  if (
    node.properties.some((property) =>
      STATE_PROPERTY_NAMES.includes(property.name),
    )
  ) {
    return 1;
  }
  return 2;
}

async function readAttributesForBackendNodeId(
  cdp: CDPSession,
  backendNodeId: number,
): Promise<Record<string, string>> {
  try {
    const response = (await cdp.send("DOM.describeNode", {
      backendNodeId,
      depth: 0,
      pierce: false,
    })) as unknown;
    const node = readRecord(readRecord(response).node);
    const rawAttributes = Array.isArray(node.attributes) ? node.attributes : [];
    const attributes: Record<string, string> = {};
    for (let i = 0; i < rawAttributes.length - 1; i += 2) {
      const name = readString(rawAttributes[i]);
      const value = readString(rawAttributes[i + 1]);
      if (name && value !== null && INTERESTING_ATTRIBUTES.has(name)) {
        if (name === "tabindex" && Number(value) < 0) continue;
        attributes[name] = value;
      }
    }
    const cursor = await readComputedCursorForBackendNodeId(cdp, backendNodeId);
    if (cursor === "pointer") attributes.cursor = cursor;
    return attributes;
  } catch {
    return {};
  }
}

async function readComputedCursorForBackendNodeId(
  cdp: CDPSession,
  backendDOMNodeId: number,
): Promise<string | null> {
  let objectId: string | null = null;
  try {
    const resolved = (await cdp.send("DOM.resolveNode", {
      backendNodeId: backendDOMNodeId,
    })) as unknown;
    objectId = readString(readRecord(readRecord(resolved).object).objectId);
    if (!objectId) return null;

    const response = (await cdp.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration:
        "function() { return getComputedStyle(this).cursor; }",
      returnByValue: true,
      silent: true,
    })) as unknown;
    return readString(readRecord(readRecord(response).result).value);
  } catch {
    return null;
  } finally {
    if (objectId) {
      await cdp.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  }
}

function buildSnapshotTree(
  rawNodes: RawAxNode[],
  attributesByBackendNodeId: Map<number, Record<string, string>>,
): MutableSnapshotNode[] {
  const byId = new Map<string, MutableSnapshotNode>();
  const childIds = new Set<string>();

  for (const rawNode of rawNodes) {
    if (!rawNode.nodeId) continue;
    byId.set(rawNode.nodeId, {
      nodeId: rawNode.nodeId,
      ignored: rawNode.ignored,
      role: rawNode.role,
      name: rawNode.name,
      value: rawNode.value,
      description: rawNode.description,
      properties: Object.fromEntries(
        rawNode.properties.map((property) => [property.name, property.value]),
      ),
      attributes:
        rawNode.backendDOMNodeId !== null
          ? (attributesByBackendNodeId.get(rawNode.backendDOMNodeId) ?? {})
          : {},
      childIds: rawNode.childIds,
      children: [],
      parent: null,
      ref: null,
      subtreeSize: 1,
    });
  }

  for (const node of byId.values()) {
    for (const childId of node.childIds) {
      const child = byId.get(childId);
      if (!child) continue;
      child.parent = node;
      node.children.push(child);
      childIds.add(childId);
    }
  }

  for (const rawNode of rawNodes) {
    if (!rawNode.parentId || childIds.has(rawNode.nodeId)) continue;
    const node = byId.get(rawNode.nodeId);
    const parent = byId.get(rawNode.parentId);
    if (!node || !parent) continue;
    node.parent = parent;
    parent.children.push(node);
    childIds.add(rawNode.nodeId);
  }

  const roots = [...byId.values()].filter((node) => !childIds.has(node.nodeId));
  for (const root of roots) annotateSubtreeSize(root);
  return roots;
}

function annotateSubtreeSize(node: MutableSnapshotNode): number {
  node.subtreeSize = 1;
  for (const child of node.children) {
    node.subtreeSize += annotateSubtreeSize(child);
  }
  return node.subtreeSize;
}

function assignRefs(nodes: MutableSnapshotNode[], nextRef: number): number {
  for (const node of nodes) {
    if (shouldAssignRef(node)) {
      node.ref = `l${nextRef}`;
      nextRef += 1;
    }
    nextRef = assignRefs(node.children, nextRef);
  }
  return nextRef;
}

function toSnapshotNode(node: MutableSnapshotNode): SnapshotNode {
  return {
    nodeId: node.nodeId,
    ignored: node.ignored,
    role: node.role,
    name: node.name,
    value: node.value,
    description: node.description,
    properties: node.properties,
    attributes: node.attributes,
    children: node.children.map(toSnapshotNode),
    ref: node.ref,
    subtreeSize: node.subtreeSize,
  };
}

function shouldAssignRef(node: MutableSnapshotNode): boolean {
  if (node.ignored) return false;
  if (node.role === "StaticText" || node.role === "InlineTextBox") return false;
  if (node.role === "none" || node.role === "presentation") return false;
  if (REFS_BY_ROLE.has(node.role)) return true;
  if (Object.keys(node.attributes).length > 0) return true;
  return Boolean(node.name);
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function readAxValueString(value: unknown): string | null {
  const rawValue = readRecord(value).value;
  if (typeof rawValue === "string") return rawValue;
  if (typeof rawValue === "number" || typeof rawValue === "boolean") {
    return String(rawValue);
  }
  return null;
}

function readAxPrimitive(value: unknown): SnapshotPrimitive {
  const rawValue = readRecord(value).value;
  if (
    typeof rawValue === "string" ||
    typeof rawValue === "number" ||
    typeof rawValue === "boolean"
  ) {
    return rawValue;
  }
  return null;
}

function unique(values: number[]): number[] {
  return [...new Set(values)];
}
