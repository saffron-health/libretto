export type Vec3 = [number, number, number];
export type Face = [number, number, number];

export interface SolidIcosahedronRotation {
  x: number;
  y: number;
  z: number;
}

export interface IcosahedronGeometry {
  faces: Face[];
  vertices: Vec3[];
}

export interface IcosahedronMesh {
  normals: Float32Array;
  positions: Float32Array;
  vertexCount: number;
}

export interface SolidIcosahedronLighting {
  accentDirection: Vec3;
  accentLight: number;
  ambient: number;
  baseColor: Vec3;
  diffuse: number;
  faceGradient: number;
  fillDirection: Vec3;
  fillLight: number;
  highlightColor: Vec3;
  lightDirection: Vec3;
  shininess: number;
  specular: number;
}

export const RADIANS: number;
export const SOLID_ICOSAHEDRON_ROTATION: SolidIcosahedronRotation;
export const SOLID_ICOSAHEDRON_SCALE: number;
export const SOLID_ICOSAHEDRON_LIGHTING: SolidIcosahedronLighting;

export function normalize(vector: Vec3): Vec3;
export function subtract(a: Vec3, b: Vec3): Vec3;
export function cross(a: Vec3, b: Vec3): Vec3;
export function dot(a: Vec3, b: Vec3): number;
export function add(a: Vec3, b: Vec3): Vec3;
export function scale(vector: Vec3, factor: number): Vec3;
export function negate(vector: Vec3): Vec3;
export function buildIcosahedron(): IcosahedronGeometry;
export function buildIcosahedronMesh(): IcosahedronMesh;
export function multiply4(a: Float32Array, b: Float32Array): Float32Array;
export function scaleMatrix(value: number): Float32Array;
export function rotateXMatrix(degrees: number): Float32Array;
export function rotateYMatrix(degrees: number): Float32Array;
export function rotateZMatrix(degrees: number): Float32Array;
export function transformPoint(matrix: Float32Array, point: Vec3): Vec3;
