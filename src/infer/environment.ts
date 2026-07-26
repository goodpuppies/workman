import type { Env as ValEnv, Scheme, TypeEnv as TyEnv, TypeInfo } from "../types.ts";

/** The SML static environment product implemented by Workman. */
export type StaticEnv = {
  strEnv: StrEnv;
  tyEnv: TyEnv;
  valEnv: ValEnv;
};

/** Structure identifiers recursively denote static environments. */
export type StrEnv = Map<string, StaticEnv>;

export function staticEnv(
  strEnv: StrEnv = new Map(),
  tyEnv: TyEnv = new Map(),
  valEnv: ValEnv = new Map(),
): StaticEnv {
  return { strEnv, tyEnv, valEnv };
}

/** Immutable-by-convention map snapshot used at semantic phase boundaries. */
export function snapshotStaticEnv(environment: StaticEnv): StaticEnv {
  return staticEnv(
    new Map([...environment.strEnv].map(([name, nested]) => [
      name,
      snapshotStaticEnv(nested),
    ])),
    new Map(environment.tyEnv),
    new Map(environment.valEnv),
  );
}

/** SML environment modification: bindings in `right` replace same-component bindings in `left`. */
export function modifyStaticEnv(left: StaticEnv, right: StaticEnv): void {
  modifyMap(left.strEnv, right.strEnv);
  modifyMap(left.tyEnv, right.tyEnv);
  modifyMap(left.valEnv, right.valEnv);
}

export function modifiedStaticEnv(left: StaticEnv, right: StaticEnv): StaticEnv {
  const result = staticEnv(
    new Map(left.strEnv),
    new Map(left.tyEnv),
    new Map(left.valEnv),
  );
  modifyStaticEnv(result, right);
  return result;
}

export function bindStructure(environment: StaticEnv, name: string, structure: StaticEnv): void {
  modifyStaticEnv(environment, staticEnv(new Map([[name, structure]])));
}

export function bindType(environment: StaticEnv, name: string, info: TypeInfo): void {
  modifyStaticEnv(environment, staticEnv(new Map(), new Map([[name, info]])));
}

export function bindValue(environment: StaticEnv, name: string, scheme: Scheme): void {
  modifyStaticEnv(environment, staticEnv(new Map(), new Map(), new Map([[name, scheme]])));
}

/** Select one spelling from every namespace, optionally renaming only its environment key. */
export function projectStaticEnv(
  environment: StaticEnv,
  name: string,
  localName = name,
): StaticEnv | undefined {
  const structure = environment.strEnv.get(name);
  const type = environment.tyEnv.get(name);
  const value = environment.valEnv.get(name);
  if (!structure && !type && !value) return undefined;
  return staticEnv(
    structure ? new Map([[localName, structure]]) : new Map(),
    type ? new Map([[localName, type]]) : new Map(),
    value ? new Map([[localName, value]]) : new Map(),
  );
}

/** Bind an implementation-provided long type name into its structural namespace. */
export function bindLongType(strEnv: StrEnv, name: string, info: TypeInfo): void {
  insertQualified(strEnv, name, (environment, member) => bindType(environment, member, info));
}

/** Build the structure portion of the legacy basis from its qualified bindings. */
export function basisStrEnv(tyEnv: TyEnv, valEnv: ValEnv): StrEnv {
  const strEnv: StrEnv = new Map();
  for (const [name, info] of tyEnv) {
    bindLongType(strEnv, name, info);
  }
  for (const [name, scheme] of valEnv) {
    insertQualified(strEnv, name, (environment, member) => bindValue(environment, member, scheme));
  }
  return strEnv;
}

export function lookupLongValue(strEnv: ReadonlyMap<string, StaticEnv>, name: string):
  | Scheme
  | undefined {
  const resolved = resolveLongValue(strEnv, name);
  return resolved?.remaining.length === 0 ? resolved.scheme : undefined;
}

export function lookupLongType(strEnv: ReadonlyMap<string, StaticEnv>, name: string):
  | TypeInfo
  | undefined {
  return resolveLongType(strEnv, name)?.info;
}

export function resolveLongType(
  strEnv: ReadonlyMap<string, StaticEnv>,
  name: string,
): { info: TypeInfo; root: StaticEnv } | undefined {
  const resolved = lookupLongEnvironment(strEnv, name);
  const info = resolved?.environment.tyEnv.get(resolved.member);
  return resolved && info ? { info, root: resolved.root } : undefined;
}

function lookupLongEnvironment(
  strEnv: ReadonlyMap<string, StaticEnv>,
  name: string,
): { environment: StaticEnv; member: string; root: StaticEnv } | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  const root = strEnv.get(parts[0]);
  if (!root) return undefined;
  let environment = root;
  for (const structure of parts.slice(1, -1)) {
    const nested = environment.strEnv.get(structure);
    if (!nested) return undefined;
    environment = nested;
  }
  return { environment, member: parts.at(-1)!, root };
}

export function resolveLongValue(
  strEnv: ReadonlyMap<string, StaticEnv>,
  name: string,
): { scheme: Scheme; remaining: string[] } | undefined {
  const parts = name.split(".");
  if (parts.length < 2) return undefined;
  let environment: StaticEnv | undefined = strEnv.get(parts[0]);
  for (let index = 1; index < parts.length; index += 1) {
    if (!environment) return undefined;
    const part = parts[index];
    if (index < parts.length - 1) {
      const nested: StaticEnv | undefined = environment.strEnv.get(part);
      if (nested) {
        environment = nested;
        continue;
      }
    }
    const scheme = environment.valEnv.get(part);
    if (!scheme) return undefined;
    return { scheme, remaining: parts.slice(index + 1) };
  }
  return undefined;
}

function modifyMap<K, V>(left: Map<K, V>, right: ReadonlyMap<K, V>): void {
  for (const [key, value] of right) left.set(key, value);
}

function insertQualified(
  strEnv: StrEnv,
  name: string,
  insert: (environment: StaticEnv, member: string) => void,
): void {
  const parts = name.split(".");
  if (parts.length < 2) return;
  const root = strEnv.get(parts[0]) ?? staticEnv();
  bindStructure(staticEnv(strEnv), parts[0], root);
  let environment: StaticEnv = root;
  for (const part of parts.slice(1, -1)) {
    const nested: StaticEnv = environment.strEnv.get(part) ?? staticEnv();
    bindStructure(environment, part, nested);
    environment = nested;
  }
  insert(environment, parts.at(-1)!);
}
