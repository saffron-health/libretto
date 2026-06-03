export const RADIANS = Math.PI / 180;

export const SOLID_ICOSAHEDRON_ROTATION = Object.freeze({
  x: 10,
  y: 144,
  z: 25,
});

export const SOLID_ICOSAHEDRON_SCALE = 0.98;

export const SOLID_ICOSAHEDRON_BASE_COLOR = Object.freeze([
  249 / 255,
  183 / 255,
  0,
]);

export const SOLID_ICOSAHEDRON_HIGHLIGHT_MIX = 0.68;

export function mixColorWithWhite([r, g, b], amount) {
  return [
    r + (1 - r) * amount,
    g + (1 - g) * amount,
    b + (1 - b) * amount,
  ];
}

export const SOLID_ICOSAHEDRON_LIGHTING = Object.freeze({
  accentDirection: [-0.95, 0.65, 0.18],
  accentLight: 0.2,
  ambient: 0.36,
  baseColor: SOLID_ICOSAHEDRON_BASE_COLOR,
  diffuse: 1.08,
  faceGradient: 0.36,
  fillDirection: [-0.75, -0.45, 0.72],
  fillLight: 0.25,
  highlightColor: mixColorWithWhite(
    SOLID_ICOSAHEDRON_BASE_COLOR,
    SOLID_ICOSAHEDRON_HIGHLIGHT_MIX,
  ),
  lightDirection: [0.82, 0.79, 0.46],
  shininess: 23,
  specular: 0.62,
});

export function normalize([x, y, z]) {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

export function subtract(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function scale([x, y, z], factor) {
  return [x * factor, y * factor, z * factor];
}

export function negate([x, y, z]) {
  return [-x, -y, -z];
}

export function buildIcosahedron() {
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

export function buildIcosahedronMesh() {
  const { faces, vertices } = buildIcosahedron();
  const positions = [];
  const normals = [];

  for (const face of faces) {
    const tri = face.map((index) => vertices[index]);
    const centroid = normalize([
      (tri[0][0] + tri[1][0] + tri[2][0]) / 3,
      (tri[0][1] + tri[1][1] + tri[2][1]) / 3,
      (tri[0][2] + tri[1][2] + tri[2][2]) / 3,
    ]);
    let normal = normalize(cross(subtract(tri[1], tri[0]), subtract(tri[2], tri[0])));
    if (dot(normal, centroid) < 0) {
      normal = negate(normal);
    }

    for (const vertex of tri) {
      positions.push(...vertex);
      normals.push(...normal);
    }
  }

  return {
    normals: new Float32Array(normals),
    positions: new Float32Array(positions),
    vertexCount: positions.length / 3,
  };
}

export function multiply4(a, b) {
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

export function scaleMatrix(value) {
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

export function rotateXMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

export function rotateYMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

export function rotateZMatrix(degrees) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

export function transformPoint(matrix, [x, y, z]) {
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
  ];
}
