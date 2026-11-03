import { BASIS_TYPES } from "./basis_manifest.ts";
import type { Ty } from "./types.ts";

/** Compiler-owned numeric identities. User types with the same name do not participate. */
export type NumericType = Readonly<{
  name: string;
  id?: number;
  bits?: number;
  signed?: boolean;
}>;

export const OPERATOR_NUMERIC_TYPES: readonly NumericType[] = [
  { name: "Number" },
  { name: "I32", bits: 32, signed: true },
];

export const INTEGER_LITERAL_TYPES: readonly NumericType[] = [
  ...OPERATOR_NUMERIC_TYPES,
  ...([8, 16, 32, 64] as const).map((bits) => ({
    name: `Word${bits}.Word`,
    id: BASIS_TYPES.find((type) => type.name === `Word${bits}.Word`)!.typeNameId,
    bits,
    signed: false,
  })),
  {
    name: "Int64.Int",
    id: BASIS_TYPES.find((type) => type.name === "Int64.Int")!.typeNameId,
    bits: 64,
    signed: true,
  },
];

// HM's nominal ids are allocated separately from the manifest's semantic ids.
const numericIdentities = new Map<number, NumericType>();

export function registerNumericIdentity(name: string, id: number): void {
  const descriptor = INTEGER_LITERAL_TYPES.find((candidate) => candidate.name === name);
  if (descriptor?.id !== undefined) numericIdentities.set(id, descriptor);
}

export function numericType(type: Ty): NumericType | undefined {
  return type.tag === "named"
    ? numericIdentities.get(type.id)
    : OPERATOR_NUMERIC_TYPES.find((candidate) =>
      type.tag === "prim" && type.name === candidate.name
    );
}

/** Signed hexadecimal literals need their sign applied separately for BigInt. */
export function exactInteger(text: string): bigint {
  return text.startsWith("-") ? -BigInt(text.slice(1)) : BigInt(text);
}

/** Keep the compact existing AST for safe numbers; retain the token when Number would lose it. */
export function integerToken(text: string): { value: number; exact?: string } {
  const value = /^-?0x/.test(text) ? Number.parseInt(text, 16) : Number(text);
  return Number.isSafeInteger(value) ? { value } : { value, exact: text };
}

/** Number keeps its existing rounding; bigint-backed exact types use the original magnitude. */
export function integerSource(literal: {
  value: number;
  exact?: string;
  numericType?: string;
}): string {
  const selected = INTEGER_LITERAL_TYPES.find((type) => type.name === literal.numericType);
  return selected?.bits === 64
    ? `${exactInteger(literal.exact ?? String(literal.value))}n`
    : String(literal.value);
}
