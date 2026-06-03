import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import {
  buildIcosahedronMesh,
  mixColorWithWhite,
  multiply4,
  rotateXMatrix,
  rotateYMatrix,
  rotateZMatrix,
  scaleMatrix,
  SOLID_ICOSAHEDRON_BASE_COLOR,
  SOLID_ICOSAHEDRON_HIGHLIGHT_MIX,
  SOLID_ICOSAHEDRON_LIGHTING,
  SOLID_ICOSAHEDRON_SCALE,
} from "./solidIcosahedronGeometry.mjs";
import type { SolidIcosahedronRotation, Vec3 } from "./solidIcosahedronGeometry.mjs";

export type { SolidIcosahedronRotation } from "./solidIcosahedronGeometry.mjs";

function glslVector([x, y, z]: Vec3) {
  return `vec3(${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)})`;
}

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
  uniform vec3 uHighlightColor;
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
    float fill = max(dot(normal, normalize(${glslVector(SOLID_ICOSAHEDRON_LIGHTING.fillDirection)})), 0.0) * uFillLight;
    float accent = max(dot(normal, normalize(${glslVector(SOLID_ICOSAHEDRON_LIGHTING.accentDirection)})), 0.0) * uAccentLight;
    vec2 lightPlane = normalize(lightDirection.xy + vec2(0.0001));
    float positionRamp = dot(vPosition.xy, lightPlane) * 0.5;
    float fragmentLight = clamp(diffuse + fill + accent + positionRamp * uFaceGradient, 0.0, 1.0);
    float specular = pow(max(dot(normal, halfwayDirection), 0.0), uShininess);
    float light = clamp(uAmbient + fragmentLight * uDiffuse, 0.0, 1.0);
    vec3 color = uBaseColor * light + uHighlightColor * specular * uSpecular;
    gl_FragColor = vec4(color, 1.0);
  }
`;

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

function clampUnit(value: number) {
  return Math.max(0, Math.min(1, value));
}

function linearizeSrgb(value: number) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function encodeSrgb(value: number) {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

function multiplyMatrixVector(matrix: number[][], vector: Vec3): Vec3 {
  return [
    matrix[0][0] * vector[0] + matrix[0][1] * vector[1] + matrix[0][2] * vector[2],
    matrix[1][0] * vector[0] + matrix[1][1] * vector[1] + matrix[1][2] * vector[2],
    matrix[2][0] * vector[0] + matrix[2][1] * vector[1] + matrix[2][2] * vector[2],
  ];
}

function displayP3ToSrgb(color: Vec3): Vec3 {
  const displayP3ToXyz = [
    [0.4865709486482162, 0.26566769316909306, 0.1982172852343625],
    [0.2289745640697488, 0.6917385218365064, 0.079286914093745],
    [0, 0.04511338185890264, 1.043944368900976],
  ];
  const xyzToSrgb = [
    [3.2404541621141045, -1.5371385127977166, -0.498531409556016],
    [-0.9692660305051868, 1.8760108454466942, 0.04155601753034983],
    [0.05564343095911473, -0.2040259135167538, 1.0572251882231791],
  ];
  const linearDisplayP3 = color.map(linearizeSrgb) as Vec3;
  const xyz = multiplyMatrixVector(displayP3ToXyz, linearDisplayP3);
  const linearSrgb = multiplyMatrixVector(xyzToSrgb, xyz);
  return linearSrgb.map((channel) => clampUnit(encodeSrgb(channel))) as Vec3;
}

function parseDisplayP3Color(value: string): Vec3 | null {
  const match = value.match(/^color\(\s*display-p3\s+([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const channels = match[1].replace(/\/.*$/, "").trim().split(/\s+/).slice(0, 3);
  if (channels.length !== 3) {
    return null;
  }

  const color = channels.map((channel) => Number(channel)) as Vec3;
  return color.every(Number.isFinite) ? color.map(clampUnit) as Vec3 : null;
}

function parseRgbColor(value: string): Vec3 | null {
  const match = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!match) {
    return null;
  }

  const channels = match[1]
    .replace(/\/.*$/, "")
    .trim()
    .split(/[,\s]+/)
    .filter(Boolean)
    .slice(0, 3);
  if (channels.length !== 3) {
    return null;
  }

  const color = channels.map((channel) => {
    if (channel.endsWith("%")) {
      return clampUnit(Number.parseFloat(channel) / 100);
    }
    return clampUnit(Number(channel) / 255);
  }) as Vec3;
  return color.every(Number.isFinite) ? color : null;
}

function parseHexColor(value: string): Vec3 | null {
  const match = value.match(/^#([\da-f]{6})$/i);
  if (!match) {
    return null;
  }

  return [
    Number.parseInt(match[1].slice(0, 2), 16) / 255,
    Number.parseInt(match[1].slice(2, 4), 16) / 255,
    Number.parseInt(match[1].slice(4, 6), 16) / 255,
  ];
}

function readSolidIcosahedronBaseColor(
  canvas: HTMLCanvasElement,
  useDisplayP3: boolean,
): Vec3 {
  const value = getComputedStyle(canvas).getPropertyValue("--color-amber").trim();
  const displayP3Color = parseDisplayP3Color(value);
  if (displayP3Color) {
    return useDisplayP3 ? displayP3Color : displayP3ToSrgb(displayP3Color);
  }

  return parseRgbColor(value) ?? parseHexColor(value) ?? SOLID_ICOSAHEDRON_BASE_COLOR;
}

function configureDrawingBufferColorSpace(gl: WebGLRenderingContext) {
  const colorManagedContext = gl as WebGLRenderingContext & {
    drawingBufferColorSpace?: PredefinedColorSpace;
  };
  if (!("drawingBufferColorSpace" in colorManagedContext)) {
    return false;
  }

  colorManagedContext.drawingBufferColorSpace = "display-p3";
  return colorManagedContext.drawingBufferColorSpace === "display-p3";
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
    const useDisplayP3 = configureDrawingBufferColorSpace(context);
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
        highlightColor: context.getUniformLocation(program, "uHighlightColor"),
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
        const spinRotation = autoRotateRef.current ? (time * 0.035) % 360 : 0;
        const projection = ortho(-1, 1, -1, 1, -10, 10);
        const model = multiply4(
          rotateZMatrix(currentRotation.z),
          multiply4(
            rotateYMatrix(currentRotation.y),
            multiply4(
              rotateXMatrix(currentRotation.x),
              multiply4(
                rotateYMatrix(spinRotation),
                scaleMatrix(SOLID_ICOSAHEDRON_SCALE),
              ),
            ),
          ),
        );

        if (autoRotateRef.current && time - lastRotationReportTime > 120) {
          lastRotationReportTime = time;
          onRotationChangeRef.current?.({
            ...currentRotation,
            y: currentRotation.y,
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
        const baseColor = readSolidIcosahedronBaseColor(canvasElement, useDisplayP3);
        const highlightColor = mixColorWithWhite(
          baseColor,
          SOLID_ICOSAHEDRON_HIGHLIGHT_MIX,
        );
        context.uniform3f(
          locations.baseColor,
          ...baseColor,
        );
        context.uniform3f(
          locations.highlightColor,
          ...highlightColor,
        );
        context.uniform3f(
          locations.lightDirection,
          ...SOLID_ICOSAHEDRON_LIGHTING.lightDirection,
        );
        context.uniform1f(
          locations.fillLight,
          SOLID_ICOSAHEDRON_LIGHTING.fillLight,
        );
        context.uniform1f(
          locations.accentLight,
          SOLID_ICOSAHEDRON_LIGHTING.accentLight,
        );
        context.uniform1f(
          locations.ambient,
          SOLID_ICOSAHEDRON_LIGHTING.ambient,
        );
        context.uniform1f(
          locations.diffuse,
          SOLID_ICOSAHEDRON_LIGHTING.diffuse,
        );
        context.uniform1f(
          locations.specular,
          SOLID_ICOSAHEDRON_LIGHTING.specular,
        );
        context.uniform1f(
          locations.shininess,
          SOLID_ICOSAHEDRON_LIGHTING.shininess,
        );
        context.uniform1f(
          locations.faceGradient,
          SOLID_ICOSAHEDRON_LIGHTING.faceGradient,
        );
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
        src="/logos/logo-dark.svg"
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
      aria-label={
        autoRotate
          ? "Live rotating solid gold icosahedron logo"
          : "Static solid gold icosahedron logo"
      }
    />
  );
}
