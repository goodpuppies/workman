const reserved = new Set([
  "const",
  "let",
  "function",
  "return",
  "if",
  "else",
  "class",
  "void",
  "globalThis",
]);

export function emitJsIdentifier(name: string): string {
  if (name.includes(".")) return name.split(".").map(emitJsIdentifier).join(".");
  return reserved.has(name) ? `_${name}` : name;
}
