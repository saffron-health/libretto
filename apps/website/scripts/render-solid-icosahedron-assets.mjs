import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  add,
  buildIcosahedron,
  cross,
  dot,
  multiply4,
  normalize,
  rotateXMatrix,
  rotateYMatrix,
  rotateZMatrix,
  scale,
  scaleMatrix,
  SOLID_ICOSAHEDRON_BASE_COLOR,
  SOLID_ICOSAHEDRON_HIGHLIGHT_MIX,
  SOLID_ICOSAHEDRON_LIGHTING,
  SOLID_ICOSAHEDRON_ROTATION,
  SOLID_ICOSAHEDRON_SCALE,
  mixColorWithWhite,
  subtract,
  transformPoint,
} from "../src/brand-kit/solidIcosahedronGeometry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logosDir = join(root, "public", "logos");

const SIZE = 1024;
const CENTER = SIZE / 2;
const VIEW_SCALE = 380;
const LOGOS = [
  {
    baseColor: SOLID_ICOSAHEDRON_BASE_COLOR,
    filename: "logo-light.svg",
    title: "Libretto logo for light mode",
  },
  {
    baseColor: [240 / 255, 207 / 255, 90 / 255],
    filename: "logo-dark.svg",
    title: "Libretto logo for dark mode",
  },
];

mkdirSync(logosDir, { recursive: true });

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function colorForFace(normal, position, baseColor) {
  const lightDirection = normalize(SOLID_ICOSAHEDRON_LIGHTING.lightDirection);
  const viewDirection = normalize(subtract([0, 0, 5], position));
  const halfwayDirection = normalize(add(lightDirection, viewDirection));
  const diffuse = Math.max(dot(normal, lightDirection), 0);
  const fill =
    Math.max(dot(normal, normalize(SOLID_ICOSAHEDRON_LIGHTING.fillDirection)), 0) *
    SOLID_ICOSAHEDRON_LIGHTING.fillLight;
  const accent =
    Math.max(dot(normal, normalize(SOLID_ICOSAHEDRON_LIGHTING.accentDirection)), 0) *
    SOLID_ICOSAHEDRON_LIGHTING.accentLight;
  const lightPlane = normalize([lightDirection[0] + 0.0001, lightDirection[1] + 0.0001, 0]);
  const positionRamp = dot([position[0], position[1], 0], lightPlane) * 0.5;
  const fragmentLight = clamp(
    diffuse + fill + accent + positionRamp * SOLID_ICOSAHEDRON_LIGHTING.faceGradient,
    0,
    1,
  );
  const specular = Math.pow(
    Math.max(dot(normal, halfwayDirection), 0),
    SOLID_ICOSAHEDRON_LIGHTING.shininess,
  );
  const light = clamp(
    SOLID_ICOSAHEDRON_LIGHTING.ambient +
      fragmentLight * SOLID_ICOSAHEDRON_LIGHTING.diffuse,
    0,
    1,
  );
  const base = baseColor;
  const highlight = mixColorWithWhite(
    baseColor,
    SOLID_ICOSAHEDRON_HIGHLIGHT_MIX,
  );
  const color = base.map((value, index) =>
    clamp(
      value * light + highlight[index] * specular * SOLID_ICOSAHEDRON_LIGHTING.specular,
      0,
      1,
    ),
  );
  return `rgb(${color.map((value) => Math.round(value * 255)).join(" ")})`;
}

function renderSvg({ baseColor, title }) {
  const { faces, vertices } = buildIcosahedron();
  const model = multiply4(
    rotateZMatrix(SOLID_ICOSAHEDRON_ROTATION.z),
    multiply4(
      rotateYMatrix(SOLID_ICOSAHEDRON_ROTATION.y),
      multiply4(
        rotateXMatrix(SOLID_ICOSAHEDRON_ROTATION.x),
        scaleMatrix(SOLID_ICOSAHEDRON_SCALE),
      ),
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
        color: colorForFace(normal, centroid, baseColor),
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
  <title>${title}</title>
  <g>
  ${polygons}
  </g>
</svg>
`;
}

for (const logo of LOGOS) {
  const svgPath = join(logosDir, logo.filename);
  writeFileSync(svgPath, renderSvg(logo));
  console.log(`Rendered ${svgPath}`);
}
