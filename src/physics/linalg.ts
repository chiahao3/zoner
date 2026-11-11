// Small dense 3-vector / 3x3 helpers. Mat3 is row-major: m[3*i + j] = M_ij.
export type Vec3 = number[];
export type Mat3 = number[];

export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export function normalize(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 0 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 1];
}
export function angleBetween(a: Vec3, b: Vec3): number {
  // atan2 form is accurate for tiny angles (acos is not).
  return Math.atan2(norm(cross(a, b)), dot(a, b));
}

export const identity = (): Mat3 => [1, 0, 0, 0, 1, 0, 0, 0, 1];

export function matVec(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}
export function matMul(a: Mat3, b: Mat3): Mat3 {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++)
      r[3 * i + j] = a[3 * i] * b[j] + a[3 * i + 1] * b[3 + j] + a[3 * i + 2] * b[6 + j];
  return r;
}
export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
export function det3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}
export function inv3(m: Mat3): Mat3 {
  const d = det3(m);
  const r = [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
  return r.map((x) => x / d);
}
/** Matrix whose columns are the given vectors. */
export const fromColumns = (a: Vec3, b: Vec3, c: Vec3): Mat3 => [a[0], b[0], c[0], a[1], b[1], c[1], a[2], b[2], c[2]];
export const column = (m: Mat3, j: number): Vec3 => [m[j], m[3 + j], m[6 + j]];

export function rotX(t: number): Mat3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [1, 0, 0, 0, c, -s, 0, s, c];
}
export function rotY(t: number): Mat3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
}
export function rotZ(t: number): Mat3 {
  const c = Math.cos(t), s = Math.sin(t);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
}
/** Rotation by angle t about unit axis u (Rodrigues). */
export function axisAngle(u: Vec3, t: number): Mat3 {
  const [x, y, z] = normalize(u);
  const c = Math.cos(t), s = Math.sin(t), C = 1 - c;
  return [
    c + x * x * C, x * y * C - z * s, x * z * C + y * s,
    y * x * C + z * s, c + y * y * C, y * z * C - x * s,
    z * x * C - y * s, z * y * C + x * s, c + z * z * C,
  ];
}
/** Re-orthonormalise a rotation matrix (Gram-Schmidt on rows) to stop drift. */
export function orthonormalize(m: Mat3): Mat3 {
  const r0 = normalize([m[0], m[1], m[2]]);
  let r1: Vec3 = [m[3], m[4], m[5]];
  r1 = normalize(sub(r1, scale(r0, dot(r0, r1))));
  const r2 = cross(r0, r1);
  return [...r0, ...r1, ...r2];
}
export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
export const gcd3 = (a: number, b: number, c: number) => gcd(gcd(a, b), c);
