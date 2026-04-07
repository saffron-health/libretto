import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "motion/react";
import { Pane } from "tweakpane";
import { ArrowUpIcon } from "../icons/ArrowUpIcon";
import { ArrowDownIcon } from "../icons/ArrowDownIcon";
import { ArrowLeftIcon } from "../icons/ArrowLeftIcon";
import { ArrowRightIcon } from "../icons/ArrowRightIcon";

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
type PointerTarget = {
  x: number;
  y: number;
  active: boolean;
  vx: number;
  vy: number;
};
type PointerState = {
  x: number;
  y: number;
  strength: number;
  vx: number;
  vy: number;
};
type WakeParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  radius: number;
  energy: number;
  swirl: number;
};

type CanvasAsciihedronProps = {
  className?: string;
  showAnnotations?: boolean;
  objectScale?: number;
};

const COLS = 160;
const ROWS = 160;
const CELL_COUNT = COLS * ROWS;
const SHADING_CHARS = ".,-~:;=!*#$@";
const LAST_SHADE_INDEX = SHADING_CHARS.length - 1;
const FACE_SHADE_STEPS = [0, 1, 3, 5, 8, 11] as const;
const SHADE_CHARACTER_GROUPS = [
  [".", ",", "-", "~", ":", ";", "=", "!", "*", "#", "$", "@"],
  [",", ".", "-", "~", ";", ":", "=", "+", "*", "#", "%", "@"],
  [".", ",", "-", ":", ";", "=", "+", "!", "*", "%", "#", "@"],
  [",", ".", "~", "~", ":", ";", "+", "*", "#", "$", "%", "@"],
] as const;

const FULL_TURN = Math.PI * 2;
const CAMERA_DISTANCE = 4.4;
const ZOOM = 190;
const TILT_X = 0;
const TILT_Z = Math.PI / 9;
const SPIN_SPEED = 0.00036;
const LIGHT_DIRECTION = normalize([0.85, 0.95, 0.65]);
const FACE_BORDER_BOOST = 1;

const POINTER_POSITION_LERP = 0.14;
const POINTER_VELOCITY_LERP = 0.18;
const POINTER_ACTIVATE_LERP = 0.14;
const POINTER_RELEASE_LERP = 0.07;

const MAX_PARTICLES = 48;

const VERTICES = createVertices();
const FACES = orientFaces(createFaces(), VERTICES);
const EDGES = createEdges(FACES);
const FACE_TEXTURE_GROUPS = assignFaceTextureGroups(FACES.length, EDGES);
const SPIN_AXIS = normalize(applyFixedTilt([0, 1, 0]));
const TILTED_VERTICES = VERTICES.map((vertex) => applyFixedTilt(vertex));

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function measureSquareScale(
  context: CanvasRenderingContext2D,
  fontSize: number,
) {
  const sample = "M".repeat(64);
  const previousFont = context.font;
  context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
  const characterWidth =
    context.measureText(sample).width / sample.length || fontSize;
  context.font = previousFont;
  return fontSize / characterWidth;
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

function rotateX([x, y, z]: Vec3, angle: number): Vec3 {
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);

  return [x, y * cosine - z * sine, y * sine + z * cosine];
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

function applyFixedTilt(vertex: Vec3): Vec3 {
  return rotateZ(rotateX(vertex, TILT_X), TILT_Z);
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
    Math.round(adjusted * (FACE_SHADE_STEPS.length - 1)),
    0,
    FACE_SHADE_STEPS.length - 1,
  );

  return FACE_SHADE_STEPS[bucket];
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
    if (edge.faces.length !== 2) {
      continue;
    }

    const [first, second] = edge.faces;
    neighbors[first].add(second);
    neighbors[second].add(first);
  }

  const groups = new Int16Array(faceCount);

  for (let faceIndex = 0; faceIndex < faceCount; faceIndex += 1) {
    const usedGroups = new Set<number>();

    for (const neighbor of neighbors[faceIndex]) {
      if (neighbor < faceIndex) {
        usedGroups.add(groups[neighbor]);
      }
    }

    let nextGroup = 0;
    while (usedGroups.has(nextGroup)) {
      nextGroup += 1;
    }

    groups[faceIndex] = nextGroup % SHADE_CHARACTER_GROUPS.length;
  }

  return groups;
}

function projectVertex(
  position: Vec3,
  cameraDistance: number,
  zoom: number,
): ProjectedVertex {
  const depth = cameraDistance - position[2];
  const invDepth = 1 / depth;

  return {
    x: COLS / 2 + position[0] * zoom * invDepth,
    y: ROWS / 2 - position[1] * zoom * invDepth,
    invDepth,
    position,
  };
}

function getShadeCharacter(shadeIndex: number, owner: number) {
  if (owner < 0) {
    return SHADING_CHARS[shadeIndex];
  }

  const textureGroup =
    FACE_TEXTURE_GROUPS[owner] % SHADE_CHARACTER_GROUPS.length;
  return (
    SHADE_CHARACTER_GROUPS[textureGroup][shadeIndex] ??
    SHADING_CHARS[shadeIndex]
  );
}

function applyFaceBorders(
  source: Int16Array,
  ownerBuffer: Int16Array,
  target: Int16Array,
  borderBoost: number,
) {
  target.set(source);

  for (let row = 1; row < ROWS - 1; row += 1) {
    const rowOffset = row * COLS;

    for (let col = 1; col < COLS - 1; col += 1) {
      const index = rowOffset + col;
      const shadeIndex = source[index];
      const owner = ownerBuffer[index];

      if (shadeIndex < 0 || owner < 0) {
        continue;
      }

      let hasDifferentNeighbor = false;
      const neighbors = [index - 1, index + 1, index - COLS, index + COLS];

      for (const neighborIndex of neighbors) {
        const neighborOwner = ownerBuffer[neighborIndex];
        if (neighborOwner >= 0 && neighborOwner !== owner) {
          hasDifferentNeighbor = true;
          break;
        }
      }

      if (hasDifferentNeighbor) {
        target[index] = clamp(shadeIndex + borderBoost, 0, LAST_SHADE_INDEX);
      }
    }
  }
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
  if (Math.abs(area) < 1e-6) {
    return;
  }

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

      if (!isInside) {
        continue;
      }

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

    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
      continue;
    }

    const invDepth = a.invDepth + (b.invDepth - a.invDepth) * t + 1e-4;
    const index = y * COLS + x;

    if (invDepth >= zBuffer[index] - 1e-4) {
      zBuffer[index] = Math.max(zBuffer[index], invDepth);
      shadeBuffer[index] = shadeIndex;
    }
  }
}

function createPointerTarget(): PointerTarget {
  return { x: 0.5, y: 0.5, active: false, vx: 0, vy: 0 };
}

function createPointerState(): PointerState {
  return { x: 0.5, y: 0.5, strength: 0, vx: 0, vy: 0 };
}

function createWakeParticle(
  x: number,
  y: number,
  vx: number,
  vy: number,
  speed: number,
  life: number,
  lifeRandom: number,
): WakeParticle {
  return {
    x,
    y,
    vx: vx * (0.93 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.0045,
    vy: vy * (0.93 + Math.random() * 0.3) + (Math.random() - 0.5) * 0.0045,
    age: 0,
    life: life + Math.random() * lifeRandom,
    radius: 0.046 + speed * 1.95 + Math.random() * 0.035,
    energy: clamp(0.88 + speed * 20, 0.88, 2),
    swirl: (Math.random() - 0.5) * (0.55 + speed * 18),
  };
}

function appendWake(
  particles: WakeParticle[],
  x: number,
  y: number,
  vx: number,
  vy: number,
  speed: number,
  life: number,
  lifeRandom: number,
  maxParticles: number,
) {
  if (speed <= 0.002) {
    return;
  }

  particles.push(createWakeParticle(x, y, vx, vy, speed, life, lifeRandom));

  while (particles.length > maxParticles) {
    particles.shift();
  }
}

const KONAMI_SEQUENCE = [
  "ArrowUp",
  "ArrowUp",
  "ArrowDown",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "ArrowLeft",
  "ArrowRight",
  "b",
  "a",
] as const;

const KEY_LABELS: Record<string, ReactNode> = {
  ArrowUp: <ArrowUpIcon className="size-3" />,
  ArrowDown: <ArrowDownIcon className="size-3" />,
  ArrowLeft: <ArrowLeftIcon className="size-3" />,
  ArrowRight: <ArrowRightIcon className="size-3" />,
  b: "B",
  a: "A",
};

type KonamiState = "idle" | "typing" | "completed" | "unlocked";

export function useKonamiPane() {
  const [konamiProgress, setKonamiProgress] = useState<ReactNode[]>([]);
  const [state, setState] = useState<KonamiState>("idle");
  const konamiIndexRef = useRef(0);
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>(0 as never);

  useEffect(() => {
    if (state === "completed" || state === "unlocked") return;

    const resetProgress = () => {
      konamiIndexRef.current = 0;
      setKonamiProgress([]);
      setState("idle");
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      clearTimeout(timeoutRef.current);

      const expected = KONAMI_SEQUENCE[konamiIndexRef.current];
      if (e.key === expected) {
        const nextIndex = konamiIndexRef.current + 1;
        konamiIndexRef.current = nextIndex;
        setKonamiProgress(
          KONAMI_SEQUENCE.slice(0, nextIndex).map((k) => KEY_LABELS[k] ?? k),
        );
        if (nextIndex === KONAMI_SEQUENCE.length) {
          setState("completed");
        } else {
          setState("typing");
          timeoutRef.current = setTimeout(resetProgress, 3000);
        }
      } else {
        resetProgress();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      clearTimeout(timeoutRef.current);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [state]);

  // Completed → unlock after 500ms
  useEffect(() => {
    if (state !== "completed") return;
    const id = setTimeout(() => {
      setKonamiProgress([]);
      setState("unlocked");
    }, 500);
    return () => clearTimeout(id);
  }, [state]);

  const closePane = useCallback(() => {
    setState("idle");
    konamiIndexRef.current = 0;
    setKonamiProgress([]);
  }, []);

  return {
    konamiProgress,
    konamiCompleted: state === "completed",
    paneUnlocked: state === "unlocked",
    closePane,
  };
}

export function KonamiOverlay({
  progress,
  completed,
}: {
  progress: ReactNode[];
  completed: boolean;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 left-4 z-50 flex gap-1.5 font-mono text-xs">
      <AnimatePresence>
        {progress.map((label, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, scale: 0.5, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.8, y: -4 }}
            transition={{ type: "spring", stiffness: 400, damping: 30 }}
            style={
              completed
                ? {
                    color: "rgb(22, 163, 74)",
                    borderColor: "rgba(22, 163, 74, 0.5)",
                    transition: "color 0.2s, border-color 0.2s",
                  }
                : undefined
            }
            className="inline-flex h-5 items-center justify-center rounded border border-stone-300/60 px-1.5 py-0.5 text-stone-400/80"
          >
            {label}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function CanvasAsciihedron({
  className = "",
  showAnnotations = true,
  objectScale = 1,
  paneUnlocked = false,
  onClosePane,
}: CanvasAsciihedronProps & {
  paneUnlocked?: boolean;
  onClosePane?: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;

    if (!container || !canvas) {
      return;
    }

    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    const zBuffer = new Float32Array(CELL_COUNT);
    const shadeBuffer = new Int16Array(CELL_COUNT);
    const ownerBuffer = new Int16Array(CELL_COUNT);
    const borderedShadeBuffer = new Int16Array(CELL_COUNT);
    const projectedVertices: ProjectedVertex[] = VERTICES.map(() => ({
      x: 0,
      y: 0,
      invDepth: 0,
      position: [0, 0, 0] as Vec3,
    }));
    const visibleFaces = new Uint8Array(FACES.length);
    const faceShades = new Int16Array(FACES.length);
    const pointerTarget = createPointerTarget();
    const pointerState = createPointerState();
    const particles: WakeParticle[] = [];

    let width = 1;
    let height = 1;
    let devicePixelRatio = 1;
    let frameId = 0;
    let previousTime = 0;
    let angle = Math.PI / 10;
    let lastPointerX = 0;
    let lastPointerY = 0;
    let lastPointerTime = 0;
    let hasPointerHistory = false;
    let lastWakeTime = 0;
    let glyphColor = "rgb(0, 0, 0)";
    let glyphR = 0;
    let glyphG = 0;
    let glyphB = 0;

    const params = {
      // Rendering
      spinSpeed: SPIN_SPEED,
      cameraDistance: CAMERA_DISTANCE,
      zoom: ZOOM,
      baseOpacity: 0.08,
      faceBorderBoost: FACE_BORDER_BOOST,
      // Scramble
      innerRadius: 1,
      outerRadius: 2,
      scrambleSpeed: 80,
      innerDensity: 40,
      outerDensity: 15,
      // Wake
      wakeRadius: 2,
      wakeDensity: 250,
      wakeLife: 640,
      wakeLifeRandom: 480,
      wakeSpawnInterval: 22,
      maxParticles: MAX_PARTICLES,
    };

    let paneContainer: HTMLDivElement | null = null;
    if (paneUnlocked) {
      paneContainer = document.createElement("div");
      paneContainer.style.cssText =
        "position:fixed;bottom:16px;left:16px;z-index:50;opacity:0;transform:translateY(8px);transition:opacity 0.3s ease,transform 0.3s ease;";
      document.body.appendChild(paneContainer);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (paneContainer) {
            paneContainer.style.opacity = "1";
            paneContainer.style.transform = "translateY(0)";
          }
        });
      });
    }
    const pane = paneContainer
      ? new Pane({ title: "Asciihedron", container: paneContainer })
      : null;

    if (pane && onClosePane) {
      pane.addButton({ title: "Close" }).on("click", onClosePane);
    }

    const renderFolder = pane?.addFolder({ title: "Rendering" });
    renderFolder?.addBinding(params, "spinSpeed", {
      label: "Spin Speed",
      min: 0,
      max: 0.005,
      step: 0.00001,
    });
    renderFolder?.addBinding(params, "cameraDistance", {
      label: "Camera Distance",
      min: 2,
      max: 10,
      step: 0.1,
    });
    renderFolder?.addBinding(params, "zoom", {
      label: "Zoom",
      min: 50,
      max: 400,
      step: 1,
    });
    renderFolder?.addBinding(params, "baseOpacity", {
      label: "Base Opacity",
      min: 0,
      max: 1,
      step: 0.01,
    });
    renderFolder?.addBinding(params, "faceBorderBoost", {
      label: "Border Boost",
      min: 0,
      max: 5,
      step: 1,
    });

    const scrambleFolder = pane?.addFolder({ title: "Scramble" });
    scrambleFolder?.addBinding(params, "innerRadius", {
      label: "Inner Radius (cells)",
      min: 0,
      max: 20,
      step: 0.5,
    });
    scrambleFolder?.addBinding(params, "outerRadius", {
      label: "Outer Radius (cells)",
      min: 0,
      max: 40,
      step: 0.5,
    });
    scrambleFolder?.addBinding(params, "scrambleSpeed", {
      label: "Scramble Speed (ms)",
      min: 16,
      max: 500,
      step: 1,
    });
    scrambleFolder?.addBinding(params, "innerDensity", {
      label: "Inner Density (%)",
      min: 0,
      max: 100,
      step: 1,
    });
    scrambleFolder?.addBinding(params, "outerDensity", {
      label: "Outer Density (%)",
      min: 0,
      max: 100,
      step: 1,
    });

    const wakeFolder = pane?.addFolder({ title: "Wake" });
    wakeFolder?.addBinding(params, "wakeRadius", {
      label: "Wake Radius (cells)",
      min: 0.5,
      max: 10,
      step: 0.5,
    });
    wakeFolder?.addBinding(params, "wakeDensity", {
      label: "Wake Density",
      min: 0,
      max: 1000,
      step: 10,
    });
    wakeFolder?.addBinding(params, "wakeLife", {
      label: "Wake Life (ms)",
      min: 100,
      max: 2000,
      step: 10,
    });
    wakeFolder?.addBinding(params, "wakeLifeRandom", {
      label: "Life Randomness (ms)",
      min: 0,
      max: 1000,
      step: 10,
    });
    wakeFolder?.addBinding(params, "wakeSpawnInterval", {
      label: "Spawn Interval (ms)",
      min: 5,
      max: 100,
      step: 1,
    });
    wakeFolder?.addBinding(params, "maxParticles", {
      label: "Max Particles",
      min: 4,
      max: 128,
      step: 1,
    });

    const resize = () => {
      const bounds = container.getBoundingClientRect();
      width = Math.max(1, bounds.width);
      height = Math.max(1, bounds.height);
      devicePixelRatio = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.round(width * devicePixelRatio);
      canvas.height = Math.round(height * devicePixelRatio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      glyphColor = getComputedStyle(container).color || "rgb(0, 0, 0)";
      // Resolve to RGB for alpha blending
      context.fillStyle = glyphColor;
      context.fillRect(0, 0, 1, 1);
      const pixel = context.getImageData(0, 0, 1, 1).data;
      glyphR = pixel[0];
      glyphG = pixel[1];
      glyphB = pixel[2];
      context.clearRect(0, 0, 1, 1);
    };

    const deactivatePointer = () => {
      pointerTarget.active = false;
      pointerTarget.vx = 0;
      pointerTarget.vy = 0;
      hasPointerHistory = false;
    };

    const handlePointerMove = (event: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      if (
        localX < 0 ||
        localX > rect.width ||
        localY < 0 ||
        localY > rect.height
      ) {
        deactivatePointer();
        return;
      }

      const now = performance.now();

      if (!hasPointerHistory) {
        lastPointerX = localX;
        lastPointerY = localY;
        lastPointerTime = now;
        hasPointerHistory = true;
      }

      const deltaMs = Math.max(16, now - lastPointerTime);
      const vx = clamp(
        ((localX - lastPointerX) / Math.max(rect.width, 1)) * (16 / deltaMs),
        -0.135,
        0.135,
      );
      const vy = clamp(
        ((localY - lastPointerY) / Math.max(rect.height, 1)) * (16 / deltaMs),
        -0.135,
        0.135,
      );

      pointerTarget.x = localX / Math.max(rect.width, 1);
      pointerTarget.y = localY / Math.max(rect.height, 1);
      pointerTarget.vx = vx;
      pointerTarget.vy = vy;
      pointerTarget.active = true;

      const speed = Math.hypot(vx, vy);
      if (now - lastWakeTime > params.wakeSpawnInterval) {
        appendWake(
          particles,
          pointerTarget.x,
          pointerTarget.y,
          vx,
          vy,
          speed,
          params.wakeLife,
          params.wakeLifeRandom,
          params.maxParticles,
        );
        lastWakeTime = now;
      }

      lastPointerX = localX;
      lastPointerY = localY;
      lastPointerTime = now;
    };

    const handleWindowMouseOut = (event: MouseEvent) => {
      if (event.relatedTarget === null) {
        deactivatePointer();
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        deactivatePointer();
      }
    };

    const renderFrame = (time: number) => {
      const delta = previousTime === 0 ? 16 : Math.min(34, time - previousTime);
      previousTime = time;
      angle = (angle + delta * params.spinSpeed) % FULL_TURN;
      pointerState.x +=
        (pointerTarget.x - pointerState.x) * POINTER_POSITION_LERP;
      pointerState.y +=
        (pointerTarget.y - pointerState.y) * POINTER_POSITION_LERP;
      pointerState.vx +=
        (pointerTarget.vx - pointerState.vx) * POINTER_VELOCITY_LERP;
      pointerState.vy +=
        (pointerTarget.vy - pointerState.vy) * POINTER_VELOCITY_LERP;
      pointerState.strength +=
        ((pointerTarget.active ? 1 : 0) - pointerState.strength) *
        (pointerTarget.active ? POINTER_ACTIVATE_LERP : POINTER_RELEASE_LERP);
      pointerTarget.vx *= pointerTarget.active ? 0.82 : 0.5;
      pointerTarget.vy *= pointerTarget.active ? 0.82 : 0.5;

      for (let index = particles.length - 1; index >= 0; index -= 1) {
        const particle = particles[index];
        particle.age += delta;

        if (particle.age >= particle.life) {
          particles.splice(index, 1);
        }
      }

      context.clearRect(0, 0, width, height);

      zBuffer.fill(-Infinity);
      shadeBuffer.fill(-1);
      ownerBuffer.fill(-1);
      visibleFaces.fill(0);

      let projectedMinX = COLS;
      let projectedMaxX = 0;
      let projectedMinY = ROWS;
      let projectedMaxY = 0;

      for (let index = 0; index < TILTED_VERTICES.length; index += 1) {
        const spun = rotateAroundAxis(TILTED_VERTICES[index], SPIN_AXIS, angle);
        const projected = projectVertex(
          spun,
          params.cameraDistance,
          params.zoom,
        );
        projected.x = COLS / 2 + (projected.x - COLS / 2) * objectScale;
        projected.y = ROWS / 2 + (projected.y - ROWS / 2) * objectScale;
        projectedVertices[index] = projected;
        projectedMinX = Math.min(projectedMinX, projected.x);
        projectedMaxX = Math.max(projectedMaxX, projected.x);
        projectedMinY = Math.min(projectedMinY, projected.y);
        projectedMaxY = Math.max(projectedMaxY, projected.y);
      }

      for (let faceIndex = 0; faceIndex < FACES.length; faceIndex += 1) {
        const [ia, ib, ic] = FACES[faceIndex];
        const a = projectedVertices[ia];
        const b = projectedVertices[ib];
        const c = projectedVertices[ic];

        const ab = subtract(b.position, a.position);
        const ac = subtract(c.position, a.position);
        const normal = normalize(cross(ab, ac));
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
          params.cameraDistance - center[2],
        ]);

        if (dot(normal, toCamera) <= 0) {
          continue;
        }

        visibleFaces[faceIndex] = 1;
        const diffuse = Math.max(0, dot(normal, LIGHT_DIRECTION));
        const brightness = clamp(0.08 + diffuse * 0.92, 0, 1);
        const shadeIndex = brightnessToShadeIndex(brightness);
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

        if (visibleAdjacentFaces.length === 0) {
          continue;
        }

        const a = projectedVertices[edge.a];
        const b = projectedVertices[edge.b];
        let shadeIndex: number;

        if (visibleAdjacentFaces.length === 1) {
          shadeIndex = clamp(
            faceShades[visibleAdjacentFaces[0]] + 3,
            5,
            LAST_SHADE_INDEX,
          );
        } else {
          const first = faceShades[visibleAdjacentFaces[0]];
          const second = faceShades[visibleAdjacentFaces[1]];
          shadeIndex = clamp(
            Math.min(first, second) - 2,
            1,
            LAST_SHADE_INDEX - 2,
          );
        }

        drawEdge(shadeBuffer, zBuffer, a, b, shadeIndex);
      }

      applyFaceBorders(
        shadeBuffer,
        ownerBuffer,
        borderedShadeBuffer,
        params.faceBorderBoost,
      );

      const cellWidth = width / COLS;
      const cellHeight = height / ROWS;
      const fontSize = Math.max(8, Math.min(cellHeight, cellWidth));
      const glyphScaleX = measureSquareScale(context, fontSize);
      const minX = clamp(Math.floor(projectedMinX) - 18, 0, COLS - 1);
      const maxX = clamp(Math.ceil(projectedMaxX) + 18, 0, COLS - 1);
      const minY = clamp(Math.floor(projectedMinY) - 18, 0, ROWS - 1);
      const maxY = clamp(Math.ceil(projectedMaxY) + 18, 0, ROWS - 1);

      context.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`;
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.lineJoin = "round";

      const pointerPixelX = pointerState.x * width;
      const pointerPixelY = pointerState.y * height;
      const innerRadius = Math.max(cellWidth, cellHeight) * params.innerRadius;
      const outerRadius = Math.max(cellWidth, cellHeight) * params.outerRadius;
      // Time seed that ticks at scrambleSpeed interval
      const timeSeed = Math.floor(time / params.scrambleSpeed);

      // Simple hash for per-cell pseudo-random scramble
      const scrambleHash = (col: number, row: number, seed: number) => {
        let h = (col * 374761 + row * 668265 + seed * 982451) | 0;
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        h = ((h >> 16) ^ h) * 0x45d9f3b;
        return ((h >> 16) ^ h) >>> 0;
      };

      // Returns: 0 = normal, 1 = inner teal, 2 = outer teal
      // Check cursor proximity AND wake particles for trail effect
      const scrambleLevel = (
        col: number,
        row: number,
        dist: number,
        baseX: number,
        baseY: number,
      ) => {
        const hash = scrambleHash(col, row, timeSeed);

        // Direct cursor proximity (existing behavior)
        if (pointerState.strength >= 0.1 && dist <= outerRadius) {
          if (dist <= innerRadius && hash % 100 < params.innerDensity) return 1;
          if ((hash >>> 8) % 100 < params.outerDensity) return 2;
        }

        // Wake trail: check proximity to wake particles
        const wakeR = Math.max(cellWidth, cellHeight) * params.wakeRadius;
        for (let i = 0; i < particles.length; i++) {
          const p = particles[i];
          const fade = 1 - p.age / p.life; // 1 → 0 as particle dies
          const pxX = p.x * width;
          const pxY = p.y * height;
          const pdx = baseX - pxX;
          const pdy = baseY - pxY;
          const pdist = Math.hypot(pdx, pdy);
          const effectRadius = wakeR * fade;
          if (pdist > effectRadius) continue;
          const t = pdist / Math.max(effectRadius, 1);
          const prob = fade * (1 - t * t); // quadratic falloff
          if ((hash >>> 4) % 1000 < prob * params.wakeDensity) return 2;
        }

        return 0;
      };

      const SCRAMBLE_CHARS = "1!|/:;.,'-`~*+=";
      const getScrambledChar = (
        _shadeIndex: number,
        col: number,
        row: number,
      ) => {
        const hash = scrambleHash(col, row, timeSeed);
        return SCRAMBLE_CHARS[hash % SCRAMBLE_CHARS.length];
      };

      const BASE_OPACITY = params.baseOpacity;
      const TEAL_INNER = `rgba(0, 140, 120, 1)`;
      const TEAL_OUTER = `rgba(40, 190, 160, 1)`;
      const BASE_COLOR = `rgba(${glyphR}, ${glyphG}, ${glyphB}, ${BASE_OPACITY})`;

      // Glow pass (additive)
      context.save();
      context.scale(glyphScaleX, 1);
      context.globalCompositeOperation = "lighter";
      context.fillStyle = BASE_COLOR;

      for (let row = minY; row <= maxY; row += 1) {
        const rowOffset = row * COLS;
        for (let col = minX; col <= maxX; col += 1) {
          const index = rowOffset + col;
          const shadeIndex = borderedShadeBuffer[index];
          if (shadeIndex < 0) continue;
          const owner = ownerBuffer[index];
          const baseX = (col + 0.5) * cellWidth;
          const baseY = (row + 0.5) * cellHeight;
          const char = getShadeCharacter(shadeIndex, owner);
          context.fillText(char, baseX / glyphScaleX, baseY);
        }
      }

      context.restore();

      // Main pass
      context.save();
      context.scale(glyphScaleX, 1);

      for (let row = minY; row <= maxY; row += 1) {
        const rowOffset = row * COLS;
        for (let col = minX; col <= maxX; col += 1) {
          const index = rowOffset + col;
          const shadeIndex = borderedShadeBuffer[index];
          if (shadeIndex < 0) continue;
          const owner = ownerBuffer[index];
          const baseX = (col + 0.5) * cellWidth;
          const baseY = (row + 0.5) * cellHeight;

          const dx = baseX - pointerPixelX;
          const dy = baseY - pointerPixelY;
          const dist = Math.hypot(dx, dy);

          const level = scrambleLevel(col, row, dist, baseX, baseY);
          if (level > 0) {
            context.fillStyle = level === 1 ? TEAL_INNER : TEAL_OUTER;
            const char = getScrambledChar(shadeIndex, col, row);
            context.fillText(char, baseX / glyphScaleX, baseY);
          } else {
            context.fillStyle = BASE_COLOR;
            const char = getShadeCharacter(shadeIndex, owner);
            context.fillText(char, baseX / glyphScaleX, baseY);
          }
        }
      }

      context.restore();

      frameId = window.requestAnimationFrame(renderFrame);
    };

    resize();

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("pointercancel", deactivatePointer);
    window.addEventListener("blur", deactivatePointer);
    window.addEventListener("mouseout", handleWindowMouseOut);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    frameId = window.requestAnimationFrame(renderFrame);

    return () => {
      cancelAnimationFrame(frameId);
      pane?.dispose();
      paneContainer?.remove();
      resizeObserver.disconnect();
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointercancel", deactivatePointer);
      window.removeEventListener("blur", deactivatePointer);
      window.removeEventListener("mouseout", handleWindowMouseOut);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [objectScale, paneUnlocked, onClosePane]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className}`}>
      <canvas ref={canvasRef} className="block h-full w-full" />
      {showAnnotations ? (
        <>
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-6 text-[10px] uppercase tracking-[0.34em] text-current/28">
            <span>Asciihedron</span>
            <span>/asciihedron</span>
          </div>
          <div className="pointer-events-none absolute bottom-6 left-6 max-w-sm text-xs leading-5 text-current/36">
            ASCII stays intact, but the glyph field now warps and trails in a
            liquid-style wake around the cursor.
          </div>
        </>
      ) : null}
    </div>
  );
}
