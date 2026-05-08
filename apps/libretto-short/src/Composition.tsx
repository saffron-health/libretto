import {
  AbsoluteFill,
  interpolate,
  useCurrentFrame,
} from "remotion";

type Vec3 = [number, number, number];
type Face = [number, number, number];
type Edge = {
  a: number;
  b: number;
  faces: number[];
};
type ProjectedVertex = {
  x: number;
  y: number;
  invDepth: number;
  position: Vec3;
};

const FULL_TURN = Math.PI * 2;
const CAMERA_DISTANCE = 4.4;
const ZOOM = 124;
const TILT_Z = Math.PI / 9;
const LIGHT_DIRECTION = normalize([0, 0.85, 0.65]);
const GLYPHS = "::;=+**##$@";
const LAST_SHADE_INDEX = GLYPHS.length - 1;
const SHADE_STEPS = [0, 1, 3, 5, 8, 11] as const;
const SHADE_CHARACTER_GROUPS = [
  [":", ":", ";", "=", "+", "+", "*", "*", "#", "#", "$", "@"],
  [":", ";", ";", "=", "=", "+", "+", "*", "*", "#", "$", "@"],
  [";", ":", "=", "=", "+", "+", "*", "*", "#", "#", "$", "@"],
  [":", ";", "=", "+", "+", "*", "*", "#", "#", "$", "$", "@"],
] as const;
const COLS = 104;
const ROWS = 104;
const VERTICES = createVertices();
const FACES = orientFaces(createFaces(), VERTICES);
const EDGES = createEdges(FACES);
const FACE_TEXTURE_GROUPS = assignFaceTextureGroups(FACES.length, EDGES);
const TILTED_VERTICES = VERTICES.map((vertex) => rotateZ(vertex, TILT_Z));
const SPIN_AXIS = normalize(rotateZ([0, 1, 0], TILT_Z));

const lines = [
  "Your agent should not be improvising in production",
  "Use deterministic browser automation",
  "Libretto",
] as const;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale(v: Vec3, factor: number): Vec3 {
  return [v[0] * factor, v[1] * factor, v[2] * factor];
}

function normalize(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

function rotateZ([x, y, z]: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  return [x * cosine - y * sine, x * sine + y * cosine, z];
}

function rotateAroundAxis(point: Vec3, axis: Vec3, angle: number): Vec3 {
  const [ux, uy, uz] = axis;
  const [x, y, z] = point;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const oneMinusCosine = 1 - cosine;

  return [
    x * (cosine + ux * ux * oneMinusCosine) +
      y * (ux * uy * oneMinusCosine - uz * sine) +
      z * (ux * uz * oneMinusCosine + uy * sine),
    x * (uy * ux * oneMinusCosine + uz * sine) +
      y * (cosine + uy * uy * oneMinusCosine) +
      z * (uy * uz * oneMinusCosine - ux * sine),
    x * (uz * ux * oneMinusCosine - uy * sine) +
      y * (uz * uy * oneMinusCosine + ux * sine) +
      z * (cosine + uz * uz * oneMinusCosine),
  ];
}

function edgeFunction(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  px: number,
  py: number,
) {
  return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

function brightnessToShadeIndex(brightness: number) {
  const adjusted = Math.pow(clamp(brightness, 0, 1), 0.72);
  const bucket = clamp(
    Math.round(adjusted * (SHADE_STEPS.length - 1)),
    0,
    SHADE_STEPS.length - 1,
  );
  return SHADE_STEPS[bucket];
}

function createVertices(): Vec3[] {
  const ringY = 1 / Math.sqrt(5);
  const ringRadius = 2 / Math.sqrt(5);
  const vertices: Vec3[] = [[0, 1, 0]];

  for (let index = 0; index < 5; index += 1) {
    const angle = (index * FULL_TURN) / 5;
    vertices.push([
      ringRadius * Math.sin(angle),
      ringY,
      ringRadius * Math.cos(angle),
    ]);
  }

  for (let index = 0; index < 5; index += 1) {
    const angle = (index * FULL_TURN) / 5 + Math.PI / 5;
    vertices.push([
      ringRadius * Math.sin(angle),
      -ringY,
      ringRadius * Math.cos(angle),
    ]);
  }

  vertices.push([0, -1, 0]);
  return vertices;
}

function createFaces(): Face[] {
  const faces: Face[] = [];

  for (let index = 0; index < 5; index += 1) {
    faces.push([0, 1 + index, 1 + ((index + 1) % 5)]);
  }

  for (let index = 0; index < 5; index += 1) {
    faces.push([1 + index, 6 + index, 1 + ((index + 1) % 5)]);
  }

  for (let index = 0; index < 5; index += 1) {
    faces.push([1 + ((index + 1) % 5), 6 + index, 6 + ((index + 1) % 5)]);
  }

  for (let index = 0; index < 5; index += 1) {
    faces.push([11, 6 + ((index + 1) % 5), 6 + index]);
  }

  return faces;
}

function orientFaces(faces: Face[], vertices: Vec3[]): Face[] {
  return faces.map(([a, b, c]) => {
    const ab = subtract(vertices[b], vertices[a]);
    const ac = subtract(vertices[c], vertices[a]);
    const normal = cross(ab, ac);
    const center = scale(
      [
        vertices[a][0] + vertices[b][0] + vertices[c][0],
        vertices[a][1] + vertices[b][1] + vertices[c][1],
        vertices[a][2] + vertices[b][2] + vertices[c][2],
      ],
      1 / 3,
    );

    return dot(normal, center) >= 0 ? [a, b, c] : [a, c, b];
  });
}

function createEdges(faces: Face[]): Edge[] {
  const edgeMap = new Map<string, Edge>();

  faces.forEach((face, faceIndex) => {
    const pairs: [number, number][] = [
      [face[0], face[1]],
      [face[1], face[2]],
      [face[2], face[0]],
    ];

    pairs.forEach(([a, b]) => {
      const min = Math.min(a, b);
      const max = Math.max(a, b);
      const key = `${min}:${max}`;
      const existing = edgeMap.get(key);

      if (existing) {
        existing.faces.push(faceIndex);
      } else {
        edgeMap.set(key, { a: min, b: max, faces: [faceIndex] });
      }
    });
  });

  return [...edgeMap.values()];
}

function assignFaceTextureGroups(faceCount: number, edges: Edge[]) {
  const neighbors = Array.from({ length: faceCount }, () => new Set<number>());

  for (const edge of edges) {
    if (edge.faces.length !== 2) continue;
    const [first, second] = edge.faces;
    neighbors[first].add(second);
    neighbors[second].add(first);
  }

  const groups = new Int16Array(faceCount);

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const usedGroups = new Set<number>();

    for (const neighbor of neighbors[faceIndex]) {
      if (neighbor < faceIndex) usedGroups.add(groups[neighbor]);
    }

    let nextGroup = 0;
    while (usedGroups.has(nextGroup)) nextGroup += 1;
    groups[faceIndex] = nextGroup % SHADE_CHARACTER_GROUPS.length;
  }

  return groups;
}

function getShadeCharacter(shadeIndex: number, owner: number) {
  if (owner < 0) return GLYPHS[shadeIndex];
  const textureGroup =
    FACE_TEXTURE_GROUPS[owner] % SHADE_CHARACTER_GROUPS.length;
  return SHADE_CHARACTER_GROUPS[textureGroup][shadeIndex] ?? GLYPHS[shadeIndex];
}

function project(vertex: Vec3): ProjectedVertex {
  const depth = CAMERA_DISTANCE - vertex[2];
  const invDepth = 1 / depth;
  return {
    x: COLS / 2 + vertex[0] * ZOOM * invDepth,
    y: ROWS / 2 - vertex[1] * ZOOM * invDepth,
    invDepth,
    position: vertex,
  };
}

function drawTriangle(
  shadeBuffer: Int16Array,
  ownerBuffer: Int16Array,
  zBuffer: Float32Array,
  a: ProjectedVertex,
  b: ProjectedVertex,
  c: ProjectedVertex,
  shadeIndex: number,
  faceIndex: number,
) {
  const area = edgeFunction(a.x, a.y, b.x, b.y, c.x, c.y);
  if (Math.abs(area) < 1e-6) return;

  const minX = clamp(Math.floor(Math.min(a.x, b.x, c.x)), 0, COLS - 1);
  const maxX = clamp(Math.ceil(Math.max(a.x, b.x, c.x)), 0, COLS - 1);
  const minY = clamp(Math.floor(Math.min(a.y, b.y, c.y)), 0, ROWS - 1);
  const maxY = clamp(Math.ceil(Math.max(a.y, b.y, c.y)), 0, ROWS - 1);
  const isPositiveArea = area > 0;

  for (let y = minY; y <= maxY; y += 1) {
    const sampleY = y + 0.5;

    for (let x = minX; x <= maxX; x += 1) {
      const sampleX = x + 0.5;
      const w0 = edgeFunction(b.x, b.y, c.x, c.y, sampleX, sampleY);
      const w1 = edgeFunction(c.x, c.y, a.x, a.y, sampleX, sampleY);
      const w2 = edgeFunction(a.x, a.y, b.x, b.y, sampleX, sampleY);
      const isInside = isPositiveArea
        ? w0 >= 0 && w1 >= 0 && w2 >= 0
        : w0 <= 0 && w1 <= 0 && w2 <= 0;

      if (!isInside) continue;

      const alpha = w0 / area;
      const beta = w1 / area;
      const gamma = w2 / area;
      const invDepth =
        alpha * a.invDepth + beta * b.invDepth + gamma * c.invDepth;
      const index = y * COLS + x;

      if (invDepth > zBuffer[index]) {
        zBuffer[index] = invDepth;
        shadeBuffer[index] = shadeIndex;
        ownerBuffer[index] = faceIndex;
      }
    }
  }
}

function drawEdge(
  shadeBuffer: Int16Array,
  zBuffer: Float32Array,
  a: ProjectedVertex,
  b: ProjectedVertex,
  shadeIndex: number,
) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const steps = Math.max(
    2,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) * 2),
  );

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const x = Math.round(a.x + dx * t);
    const y = Math.round(a.y + dy * t);

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) continue;

    const invDepth = a.invDepth + (b.invDepth - a.invDepth) * t + 1e-4;
    const index = y * COLS + x;

    if (invDepth >= zBuffer[index] - 1e-4) {
      zBuffer[index] = Math.max(zBuffer[index], invDepth);
      shadeBuffer[index] = shadeIndex;
    }
  }
}

function applyFaceBorders(
  source: Int16Array,
  ownerBuffer: Int16Array,
  target: Int16Array,
) {
  target.set(source);

  for (let row = 1; row < ROWS - 1; row += 1) {
    const rowOffset = row * COLS;

    for (let col = 1; col < COLS - 1; col += 1) {
      const index = rowOffset + col;
      const shadeIndex = source[index];
      const owner = ownerBuffer[index];
      if (shadeIndex < 0 || owner < 0) continue;

      const neighbors = [index - 1, index + 1, index - COLS, index + COLS];
      const hasDifferentNeighbor = neighbors.some((neighborIndex) => {
        const neighborOwner = ownerBuffer[neighborIndex];
        return neighborOwner >= 0 && neighborOwner !== owner;
      });

      if (hasDifferentNeighbor) {
        target[index] = clamp(shadeIndex + 1, 0, LAST_SHADE_INDEX);
      }
    }
  }
}

function renderAsciihedron(frame: number) {
  const angle = frame * 0.008 + Math.PI / 10 + 0.27;
  const projectedVertices = TILTED_VERTICES.map((vertex) => {
    const spun = rotateAroundAxis(vertex, SPIN_AXIS, angle);
    const projected = project(spun);
    const objectScale = 1.18;
    return {
      ...projected,
      x: COLS / 2 + (projected.x - COLS / 2) * objectScale,
      y: ROWS / 2 + (projected.y - ROWS / 2) * objectScale,
    };
  });
  const shadeBuffer = new Int16Array(COLS * ROWS);
  const ownerBuffer = new Int16Array(COLS * ROWS);
  const borderedShadeBuffer = new Int16Array(COLS * ROWS);
  const zBuffer = new Float32Array(COLS * ROWS);
  const visibleFaces = new Uint8Array(FACES.length);
  const faceShades = new Int16Array(FACES.length);
  shadeBuffer.fill(-1);
  ownerBuffer.fill(-1);
  zBuffer.fill(-Infinity);

  for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
    const [ia, ib, ic] = FACES[faceIndex];
    const a = projectedVertices[ia];
    const b = projectedVertices[ib];
    const c = projectedVertices[ic];
    const normal = normalize(
      cross(subtract(b.position, a.position), subtract(c.position, a.position)),
    );
    const center = scale(
      [
        a.position[0] + b.position[0] + c.position[0],
        a.position[1] + b.position[1] + c.position[1],
        a.position[2] + b.position[2] + c.position[2],
      ],
      1 / 3,
    );
    const toCamera = normalize([
      -center[0],
      -center[1],
      CAMERA_DISTANCE - center[2],
    ]);

    if (dot(normal, toCamera) <= 0) continue;

    visibleFaces[faceIndex] = 1;
    const diffuse = Math.max(0, dot(normal, LIGHT_DIRECTION));
    const shadeIndex = brightnessToShadeIndex(
      clamp(0.08 + diffuse * 0.92, 0, 1),
    );
    faceShades[faceIndex] = shadeIndex;
    drawTriangle(
      shadeBuffer,
      ownerBuffer,
      zBuffer,
      a,
      b,
      c,
      shadeIndex,
      faceIndex,
    );
  }

  for (const edge of EDGES) {
    const visibleAdjacentFaces = edge.faces.filter(
      (faceIndex) => visibleFaces[faceIndex] === 1,
    );
    if (visibleAdjacentFaces.length === 0) continue;

    const a = projectedVertices[edge.a];
    const b = projectedVertices[edge.b];
    const shadeIndex =
      visibleAdjacentFaces.length === 1
        ? clamp(faceShades[visibleAdjacentFaces[0]] + 3, 5, LAST_SHADE_INDEX)
        : clamp(
            Math.min(
              faceShades[visibleAdjacentFaces[0]],
              faceShades[visibleAdjacentFaces[1]],
            ) - 2,
            1,
            LAST_SHADE_INDEX - 2,
          );

    drawEdge(shadeBuffer, zBuffer, a, b, shadeIndex);
  }

  applyFaceBorders(shadeBuffer, ownerBuffer, borderedShadeBuffer);

  const rows: string[] = [];
  for (let row = 0; row < ROWS; row += 1) {
    let line = "";
    for (let col = 0; col < COLS; col += 1) {
      const index = row * COLS + col;
      const shade = borderedShadeBuffer[index];
      const owner = ownerBuffer[index];
      line += shade < 0 ? " " : getShadeCharacter(shade, owner);
    }
    rows.push(line);
  }
  return rows.join("\n");
}

function TextLine({
  children,
  startFrame,
  variant,
}: {
  children: string;
  startFrame: number;
  variant: "headline" | "subhead" | "brand";
}) {
  const frame = useCurrentFrame();

  return (
    <div
      className={`copy-line copy-line--${variant}`}
      style={{
        opacity: frame >= startFrame ? 1 : 0,
      }}
    >
      {children}
    </div>
  );
}

export const LibrettoShort = () => {
  const frame = useCurrentFrame();
  const ascii = renderAsciihedron(frame);
  const shapeOpacity = interpolate(
    frame,
    [0, 170, 210],
    [0.19, 0.19, 0.12],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const driftX = Math.sin(frame * 0.018) * 20;
  const driftY = Math.cos(frame * 0.015) * 16;
  const shapeScale = interpolate(
    Math.sin(frame * 0.012),
    [-1, 1],
    [0.85, 0.89],
  );

  return (
    <AbsoluteFill className="render-canvas">
      <div className="scene">
        <div className="paper-grain" />
        <pre
          className="ascii-shape"
          style={{
            opacity: shapeOpacity,
            transform: `translate(calc(-50% + 620px + ${driftX}px), calc(-50% + 20px + ${driftY}px)) scale(${shapeScale})`,
          }}
        >
          {ascii}
        </pre>
        <div className="copy-stack">
          <TextLine startFrame={20} variant="headline">
            {lines[0]}
          </TextLine>
          <TextLine startFrame={96} variant="subhead">
            {lines[1]}
          </TextLine>
          <TextLine startFrame={164} variant="brand">
            {lines[2]}
          </TextLine>
        </div>
        <div className="corner-mark">/libretto</div>
      </div>
    </AbsoluteFill>
  );
};
