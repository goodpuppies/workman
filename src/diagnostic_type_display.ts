const typeNames = [
  "T",
  "U",
  "V",
  "W",
  "X",
  "Y",
  "Z",
  "A",
  "B",
  "C",
  "D",
  "E",
];

export function displayTypeVariables(text: string): string {
  const names = new Map<string, string>();
  return text.replace(/'[A-Za-z_][A-Za-z0-9_]*|'[0-9]+/g, (match) => {
    const existing = names.get(match);
    if (existing) return existing;
    const next = names.size < typeNames.length ? typeNames[names.size] : `T${names.size + 1}`;
    names.set(match, next);
    return next;
  });
}
