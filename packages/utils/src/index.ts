export const pkg = "@iamtoxa/md-engine-utils";
export function assert(cond: unknown, msg = "Assertion failed"): asserts cond {
  if (!cond) throw new Error(msg);
}
export function clamp(x: number, min: number, max: number) {
  return x < min ? min : x > max ? max : x;
}
