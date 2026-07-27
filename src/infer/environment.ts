import type { LongId } from "../ast.ts";
import { parseLongId } from "../ast.ts";
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
export function bindLongType(strEnv: StrEnv, path: LongId, info: TypeInfo): void {
  insertQualified(strEnv, path, (environment, member) => bindType(environment, member, info));
}

/**
 * Build the structure portion of the basis from its qualified table entries.
 *
 * The basis manifest is a compiler-owned table whose keys are authored as dotted
 * spellings. Parsing them here is construction of a structure environment, not
 * semantic name resolution: after this point every lookup goes through `StrEnv`.
 */
export function basisStrEnv(tyEnv: TyEnv, valEnv: ValEnv): StrEnv {
  const strEnv: StrEnv = new Map();
  for (const [name, info] of tyEnv) {
    bindLongType(strEnv, parseLongId(name), info);
  }
  for (const [name, scheme] of valEnv) {
    insertQualified(
      strEnv,
      parseLongId(name),
      (environment, member) => bindValue(environment, member, scheme),
    );
  }
  return strEnv;
}

export function lookupLongValue(strEnv: ReadonlyMap<string, StaticEnv>, path: LongId):
  | Scheme
  | undefined {
  const resolved = resolveLongValue(strEnv, path);
  return resolved?.remaining.length === 0 ? resolved.scheme : undefined;
}

export function lookupLongType(strEnv: ReadonlyMap<string, StaticEnv>, path: LongId):
  | TypeInfo
  | undefined {
  return resolveLongType(strEnv, path)?.info;
}

export function resolveLongType(
  strEnv: ReadonlyMap<string, StaticEnv>,
  path: LongId,
): { info: TypeInfo; root: StaticEnv } | undefined {
  const resolved = lookupLongEnvironment(strEnv, path);
  const info = resolved?.environment.tyEnv.get(resolved.member);
  return resolved && info ? { info, root: resolved.root } : undefined;
}

/**
 * The Definition's `E(longtycon)`: project `SE` once per structure identifier,
 * then look the base identifier up in the reached environment's component.
 */
function lookupLongEnvironment(
  strEnv: ReadonlyMap<string, StaticEnv>,
  path: LongId,
): { environment: StaticEnv; member: string; root: StaticEnv } | undefined {
  const [first, ...nestedQualifiers] = path.qualifiers;
  if (first === undefined) return undefined;
  const root = strEnv.get(first);
  if (!root) return undefined;
  let environment = root;
  for (const structure of nestedQualifiers) {
    const nested = environment.strEnv.get(structure);
    if (!nested) return undefined;
    environment = nested;
  }
  return { environment, member: path.id, root };
}

/**
 * `E(longvid)`, allowing the base identifier to be reached before the qualifier
 * list is exhausted. The unconsumed qualifiers are returned as `remaining` so a
 * caller can continue with record-field projection through a value.
 */
export function resolveLongValue(
  strEnv: ReadonlyMap<string, StaticEnv>,
  path: LongId,
): { scheme: Scheme; remaining: string[] } | undefined {
  const [first, ...rest] = path.qualifiers;
  if (first === undefined) return undefined;
  const members = [...rest, path.id];
  let environment: StaticEnv | undefined = strEnv.get(first);
  for (let index = 0; index < members.length; index += 1) {
    if (!environment) return undefined;
    const member = members[index];
    if (index < members.length - 1) {
      const nested: StaticEnv | undefined = environment.strEnv.get(member);
      if (nested) {
        environment = nested;
        continue;
      }
    }
    const scheme = environment.valEnv.get(member);
    if (!scheme) return undefined;
    return { scheme, remaining: members.slice(index + 1) };
  }
  return undefined;
}

function modifyMap<K, V>(left: Map<K, V>, right: ReadonlyMap<K, V>): void {
  for (const [key, value] of right) left.set(key, value);
}

function insertQualified(
  strEnv: StrEnv,
  path: LongId,
  insert: (environment: StaticEnv, member: string) => void,
): void {
  const [first, ...nestedQualifiers] = path.qualifiers;
  if (first === undefined) return;
  const root = strEnv.get(first) ?? staticEnv();
  bindStructure(staticEnv(strEnv), first, root);
  let environment: StaticEnv = root;
  for (const qualifier of nestedQualifiers) {
    const nested: StaticEnv = environment.strEnv.get(qualifier) ?? staticEnv();
    bindStructure(environment, qualifier, nested);
    environment = nested;
  }
  insert(environment, path.id);
}
