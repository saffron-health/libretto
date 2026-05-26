import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logosDir = join(root, "public", "brand-kit", "logos");

const SIZE = 1024;
const CENTER = SIZE / 2;
const VIEW_SCALE = 380;
const RADIANS = Math.PI / 180;
const ROTATION = { x: 0, y: 144, z: 18 };

mkdirSync(logosDir, { recursive: true });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function scale([x, y, z], factor) {
  return [x * factor, y * factor, z * factor];
}

function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let row = 0; row < 4; row += 1) {
    for (let col = 0; col < 4; col += 1) {
      out[col * 4 + row] =
        a[row] * b[col * 4] +
        a[4 + row] * b[col * 4 + 1] +
        a[8 + row] * b[col * 4 + 2] +
        a[12 + row] * b[col * 4 + 3];
    }
  }
  return out;
}

function scaleMatrix(value) {
  return new Float32Array([
    value,
    0,
    0,
    0,
    0,
    value,
    0,
    0,
    0,
    0,
    value,
    0,
    0,
    0,
    0,
    1,
  ]);
}

function rotateXMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateYMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotateZMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}

function buildIcosahedron() {
  const a = 1 / Math.sqrt(5);
  const r = Math.sqrt(1 - a * a);
  const vertices = [[0, 1, 0]];

  for (let i = 0; i < 5; i += 1) {
    const t = (90 + i * 72) * RADIANS;
    vertices.push([r * Math.cos(t), a, r * Math.sin(t)]);
  }

  for (let i = 0; i < 5; i += 1) {
    const t = (126 + i * 72) * RADIANS;
    vertices.push([r * Math.cos(t), -a, r * Math.sin(t)]);
  }

  vertices.push([0, -1, 0]);

  const faces = [];
  for (let i = 0; i < 5; i += 1) {
    const top = 1 + i;
    const nextTop = 1 + ((i + 1) % 5);
    const bottom = 6 + i;
    const prevBottom = 6 + ((i + 4) % 5);
    const nextBottom = 6 + ((i + 1) % 5);
    faces.push(
      [0, top, nextTop],
      [top, nextTop, bottom],
      [top, bottom, prevBottom],
      [11, nextBottom, bottom],
    );
  }

  return { faces, vertices };
}

function colorForFace(normal, position) {
  const lightDirection = normalize([0.82, 0.79, 0.46]);
  const viewDirection = normalize(subtract([0, 0, 5], position));
  const halfwayDirection = normalize(add(lightDirection, viewDirection));
  const diffuse = Math.max(dot(normal, lightDirection), 0);
  const fill =
    Math.max(dot(normal, normalize([-0.75, -0.45, 0.72])), 0) * 0.25;
  const accent =
    Math.max(dot(normal, normalize([-0.95, 0.65, 0.18])), 0) * 0.2;
  const lightPlane = normalize([lightDirection[0] + 0.0001, lightDirection[1] + 0.0001, 0]);
  const positionRamp = dot([position[0], position[1], 0], lightPlane) * 0.5;
  const fragmentLight = clamp(diffuse + fill + accent + positionRamp * 0.36, 0, 1);
  const specular = Math.pow(Math.max(dot(normal, halfwayDirection), 0), 23);
  const light = clamp(0.36 + fragmentLight * 1.08, 0, 1);
  const base = [1, 0.79, 0.14];
  const highlight = [1, 0.93, 0.72];
  const color = base.map((value, index) =>
    clamp(value * light + highlight[index] * specular * 0.62, 0, 1),
  );
  return `rgb(${color.map((value) => Math.round(value * 255)).join(" ")})`;
}

function renderSvg() {
  const { faces, vertices } = buildIcosahedron();
  const model = multiply4(
    rotateZMatrix(ROTATION.z),
    multiply4(
      rotateYMatrix(ROTATION.y),
      multiply4(rotateXMatrix(ROTATION.x), scaleMatrix(0.98)),
    ),
  );

  const polygons = faces
    .map((face) => {
      const tri = face.map((index) => transformPoint(model, vertices[index]));
      const centroid = scale(add(add(tri[0], tri[1]), tri[2]), 1 / 3);
      let normal = normalize(cross(subtract(tri[1], tri[0]), subtract(tri[2], tri[0])));
      if (dot(normal, normalize(centroid)) < 0) {
        normal = scale(normal, -1);
      }

      const points = tri
        .map(([x, y]) => `${(CENTER + x * VIEW_SCALE).toFixed(2)},${(CENTER - y * VIEW_SCALE).toFixed(2)}`)
        .join(" ");

      return {
        color: colorForFace(normal, centroid),
        depth: centroid[2],
        points,
      };
    })
    .sort((a, b) => a.depth - b.depth)
    .map(
      (polygon) =>
        `<polygon points="${polygon.points}" fill="${polygon.color}" stroke="rgb(255 219 95)" stroke-opacity="0.08" stroke-width="1"/>`,
    )
    .join("\n  ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" fill="none">
  <title>Libretto solid gold icosahedron mark</title>
  <g>
  ${polygons}
  </g>
</svg>
`;
}

const svg = renderSvg();
const svgPath = join(logosDir, "libretto-icosahedron-yellow.svg");
const pngPath = join(logosDir, "libretto-icosahedron-yellow-1024.png");

writeFileSync(svgPath, svg);
await sharp(Buffer.from(svg)).resize(SIZE, SIZE).png().toFile(pngPath);

console.log(`Rendered ${svgPath}`);
console.log(`Rendered ${pngPath}`);
