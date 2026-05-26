import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

type Vec3 = [number, number, number];
type Face = [number, number, number];

export interface SolidIcosahedronRotation {
  x: number;
  y: number;
  z: number;
}

const RADIANS = Math.PI / 180;

const vertexShaderSource = `
  attribute vec3 aPosition;
  attribute vec3 aNormal;
  uniform mat4 uModel;
  uniform mat4 uProjection;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec4 worldPosition = uModel * vec4(aPosition, 1.0);
    vPosition = worldPosition.xyz;
    vNormal = normalize(mat3(uModel) * aNormal);
    gl_Position = uProjection * worldPosition;
  }
`;

const fragmentShaderSource = `
  precision highp float;
  uniform vec3 uBaseColor;
  uniform vec3 uLightDirection;
  uniform float uFillLight;
  uniform float uAccentLight;
  uniform float uAmbient;
  uniform float uDiffuse;
  uniform float uSpecular;
  uniform float uShininess;
  uniform float uFaceGradient;
  varying vec3 vNormal;
  varying vec3 vPosition;
  void main() {
    vec3 normal = normalize(vNormal);
    vec3 lightDirection = normalize(uLightDirection);
    vec3 viewDirection = normalize(vec3(0.0, 0.0, 5.0) - vPosition);
    vec3 halfwayDirection = normalize(lightDirection + viewDirection);
    float diffuse = max(dot(normal, lightDirection), 0.0);
    float fill = max(dot(normal, normalize(vec3(-0.75, -0.45, 0.72))), 0.0) * uFillLight;
    float accent = max(dot(normal, normalize(vec3(-0.95, 0.65, 0.18))), 0.0) * uAccentLight;
    vec2 lightPlane = normalize(lightDirection.xy + vec2(0.0001));
    float positionRamp = dot(vPosition.xy, lightPlane) * 0.5;
    float fragmentLight = clamp(diffuse + fill + accent + positionRamp * uFaceGradient, 0.0, 1.0);
    float specular = pow(max(dot(normal, halfwayDirection), 0.0), uShininess);
    float light = clamp(uAmbient + fragmentLight * uDiffuse, 0.0, 1.0);
    vec3 color = uBaseColor * light + vec3(1.0, 0.93, 0.72) * specular * uSpecular;
    gl_FragColor = vec4(color, 1.0);
  }
`;

function normalize([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

function subtract(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot(a: Vec3, b: Vec3) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function negate([x, y, z]: Vec3): Vec3 {
  return [-x, -y, -z];
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Unable to create WebGL shader.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader) ?? "Unable to compile shader.");
  }

  return shader;
}

function createProgram(gl: WebGLRenderingContext) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Unable to create WebGL program.");
  }

  gl.attachShader(program, compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource));
  gl.attachShader(
    program,
    compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource),
  );
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? "Unable to link program.");
  }

  return program;
}

function buildIcosahedronMesh() {
  const a = 1 / Math.sqrt(5);
  const r = Math.sqrt(1 - a * a);
  const vertices: Vec3[] = [[0, 1, 0]];

  for (let i = 0; i < 5; i += 1) {
    const t = (90 + i * 72) * RADIANS;
    vertices.push([r * Math.cos(t), a, r * Math.sin(t)]);
  }

  for (let i = 0; i < 5; i += 1) {
    const t = (126 + i * 72) * RADIANS;
    vertices.push([r * Math.cos(t), -a, r * Math.sin(t)]);
  }

  vertices.push([0, -1, 0]);

  const faces: Face[] = [];
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

  const positions: number[] = [];
  const normals: number[] = [];
  for (const face of faces) {
    const tri = face.map((index) => vertices[index]) as [Vec3, Vec3, Vec3];
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

function multiply4(a: Float32Array, b: Float32Array) {
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

function scaleMatrix(value: number) {
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

function rotateXMatrix(degrees: number) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
}

function rotateYMatrix(degrees: number) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
}

function rotateZMatrix(degrees: number) {
  const c = Math.cos(degrees * RADIANS);
  const s = Math.sin(degrees * RADIANS);
  return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

function ortho(
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
) {
  return new Float32Array([
    2 / (right - left),
    0,
    0,
    0,
    0,
    2 / (top - bottom),
    0,
    0,
    0,
    0,
    -2 / (far - near),
    0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    -(far + near) / (far - near),
    1,
  ]);
}

export function SolidIcosahedron({
  autoRotate = true,
  className = "",
  onRotationChange,
  rotation,
  style,
}: {
  autoRotate?: boolean;
  className?: string;
  onRotationChange?: (rotation: SolidIcosahedronRotation) => void;
  rotation: SolidIcosahedronRotation;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const autoRotateRef = useRef(autoRotate);
  const onRotationChangeRef = useRef(onRotationChange);
  const rotationRef = useRef(rotation);
  const [hasWebGL, setHasWebGL] = useState(true);

  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  useEffect(() => {
    onRotationChangeRef.current = onRotationChange;
  }, [onRotationChange]);

  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });

    if (!gl) {
      setHasWebGL(false);
      return;
    }

    const canvasElement = canvas;
    const context = gl;
    let frameId = 0;
    let lastRotationReportTime = 0;

    try {
      const program = createProgram(context);
      const mesh = buildIcosahedronMesh();
      const locations = {
        accentLight: context.getUniformLocation(program, "uAccentLight"),
        ambient: context.getUniformLocation(program, "uAmbient"),
        baseColor: context.getUniformLocation(program, "uBaseColor"),
        diffuse: context.getUniformLocation(program, "uDiffuse"),
        faceGradient: context.getUniformLocation(program, "uFaceGradient"),
        fillLight: context.getUniformLocation(program, "uFillLight"),
        lightDirection: context.getUniformLocation(program, "uLightDirection"),
        model: context.getUniformLocation(program, "uModel"),
        normal: context.getAttribLocation(program, "aNormal"),
        position: context.getAttribLocation(program, "aPosition"),
        projection: context.getUniformLocation(program, "uProjection"),
        shininess: context.getUniformLocation(program, "uShininess"),
        specular: context.getUniformLocation(program, "uSpecular"),
      };

      const positionBuffer = context.createBuffer();
      context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
      context.bufferData(context.ARRAY_BUFFER, mesh.positions, context.STATIC_DRAW);

      const normalBuffer = context.createBuffer();
      context.bindBuffer(context.ARRAY_BUFFER, normalBuffer);
      context.bufferData(context.ARRAY_BUFFER, mesh.normals, context.STATIC_DRAW);

      function render(time: number) {
        const ratio = window.devicePixelRatio || 1;
        const size = Math.round(canvasElement.clientWidth * ratio);
        if (canvasElement.width !== size || canvasElement.height !== size) {
          canvasElement.width = size;
          canvasElement.height = size;
        }

        context.viewport(0, 0, canvasElement.width, canvasElement.height);
        context.clearColor(17 / 255, 17 / 255, 17 / 255, 0);
        context.clear(context.COLOR_BUFFER_BIT | context.DEPTH_BUFFER_BIT);
        context.enable(context.DEPTH_TEST);
        context.disable(context.CULL_FACE);

        const currentRotation = rotationRef.current;
        const yRotation = autoRotateRef.current
          ? (time * 0.035) % 360
          : currentRotation.y;
        const projection = ortho(-1, 1, -1, 1, -10, 10);
        const model = multiply4(
          rotateZMatrix(currentRotation.z),
          multiply4(
            rotateYMatrix(yRotation),
            multiply4(rotateXMatrix(currentRotation.x), scaleMatrix(0.98)),
          ),
        );

        if (autoRotateRef.current && time - lastRotationReportTime > 120) {
          lastRotationReportTime = time;
          onRotationChangeRef.current?.({
            ...currentRotation,
            y: Math.round(yRotation),
          });
        }

        context.useProgram(program);
        context.bindBuffer(context.ARRAY_BUFFER, positionBuffer);
        context.enableVertexAttribArray(locations.position);
        context.vertexAttribPointer(
          locations.position,
          3,
          context.FLOAT,
          false,
          0,
          0,
        );
        context.bindBuffer(context.ARRAY_BUFFER, normalBuffer);
        context.enableVertexAttribArray(locations.normal);
        context.vertexAttribPointer(
          locations.normal,
          3,
          context.FLOAT,
          false,
          0,
          0,
        );
        context.uniformMatrix4fv(locations.model, false, model);
        context.uniformMatrix4fv(locations.projection, false, projection);
        context.uniform3f(locations.baseColor, 1.0, 0.79, 0.14);
        context.uniform3f(locations.lightDirection, 0.82, 0.79, 0.46);
        context.uniform1f(locations.fillLight, 0.25);
        context.uniform1f(locations.accentLight, 0.2);
        context.uniform1f(locations.ambient, 0.36);
        context.uniform1f(locations.diffuse, 1.08);
        context.uniform1f(locations.specular, 0.62);
        context.uniform1f(locations.shininess, 23);
        context.uniform1f(locations.faceGradient, 0.36);
        context.drawArrays(context.TRIANGLES, 0, mesh.vertexCount);

        frameId = requestAnimationFrame(render);
      }

      frameId = requestAnimationFrame(render);
    } catch {
      setHasWebGL(false);
    }

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  if (!hasWebGL) {
    return (
      <img
        src="/brand-kit/logos/libretto-icosahedron-yellow.svg"
        alt="Solid gold icosahedron logo"
        className={className}
        style={style}
      />
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={style}
      aria-label="Live rotating solid gold icosahedron logo"
    />
  );
}
