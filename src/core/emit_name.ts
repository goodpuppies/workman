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
  if (name.includes(".")) {
    const [root, ...members] = name.split(".");
    return members.reduce(emitJsMember, emitJsIdentifier(root));
  }
  // Source identifiers cannot contain $, so this encoding cannot collide with authored names.
  const identifier = name.replaceAll("'", "$prime");
  return reserved.has(identifier) ? `_${identifier}` : identifier;
}

export function emitJsPropertyKey(name: string): string {
  return name.includes("'") ? JSON.stringify(name) : emitJsIdentifier(name);
}

export function emitJsMember(owner: string, name: string): string {
  return name.includes("'")
    ? `${owner}[${JSON.stringify(name)}]`
    : `${owner}.${emitJsIdentifier(name)}`;
}
