import { assertEquals } from "@std/assert";
import type { InferStep, TypeSnapshot } from "../src/infer.ts";
import type { Surface } from "../src/parser.ts";
import { show } from "../src/types.ts";

export type SurfaceName = Surface;

export function expectBinding(
  env: Map<string, { vars: number[]; type: unknown }>,
  name: string,
  expected: TypeSnapshot,
) {
  const scheme = env.get(name);
  if (!scheme) throw new Error(`missing inferred binding ${name}`);
  assertEquals({ type: show(scheme.type as never), vars: scheme.vars.length }, expected);
}

export function expectStepBinding(
  steps: InferStep[],
  stepIndex: number,
  name: string,
  expected: TypeSnapshot,
) {
  const step = steps[stepIndex];
  if (!step) throw new Error(`missing elaboration step ${stepIndex}`);
  const snapshot = step.env.get(name);
  if (!snapshot) throw new Error(`missing binding ${name} at elaboration step ${stepIndex}`);
  assertEquals(snapshot, expected);
}

export function expectStepMissing(
  steps: InferStep[],
  stepIndex: number,
  name: string,
) {
  const step = steps[stepIndex];
  if (!step) throw new Error(`missing elaboration step ${stepIndex}`);
  assertEquals(step.env.has(name), false);
}
