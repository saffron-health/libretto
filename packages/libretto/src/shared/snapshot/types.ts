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
