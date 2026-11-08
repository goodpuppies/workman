import type { Ty } from "./types.ts";

/**
 * `!` is a bit on the type. Concrete nodes are immutable values, so a clean one is permanently clean
 * and never needs a link. HM variables and occurrence views are the only mutable positions.
 *
 * A sequence reads its members when built. Only a member still held open by an HM variable leaves a
 * link, and links are ordinary references that instantiation maps like any other variable.
 */
const NONE: Ty[] = [];
const bindable = (t: Ty) => t.tag === "var" || t.tag === "ffi";

/** The last variable of a binding chain, which is HM's own union-find representative. */
export function chainEnd(t: Ty): Ty {
  while ((t.tag === "var" || t.tag === "ffi") && t.instance) {
    const following: Ty = t.instance;
    if (following.tag !== "var" && following.tag !== "ffi") return t;
    t = following;
  }
  return t;
}

/** A variable something still refers to for `!`, so HM compression must not skip over it. */
export const held = (t: Ty): boolean =>
  !!(t.tainted || ((t.tag === "var" || t.tag === "ffi") && (t.deps || t.linked)));

function position(t: Ty): Ty {
  if (t.tag === "view") return t;
  const end = chainEnd(t);
  if (bindable(end)) {
    const instance = (end as { instance?: Ty }).instance;
    if (instance?.tag === "view") return instance;
  }
  return end;
}

const next = (t: Ty): Ty | undefined =>
  t.tag === "view" ? t.value : t.tag === "var" || t.tag === "ffi" ? t.instance : undefined;

/** Outer `!`, or any contained `!`. Function bodies stay latent; a function's own `!` counts. */
function carries(t: Ty, seen?: Set<Ty>): boolean {
  let c = t;
  while (true) {
    if (c.tainted) return true;
    if (c.tag !== "view" && c.tag !== "var" && c.tag !== "ffi") break;
    if (c.deps) {
      seen ??= new Set();
      if (!seen.has(c)) {
        seen.add(c);
        for (const dep of c.deps) if (carries(dep, seen)) return true;
      }
    }
    if (c.tag === "view") c = c.value;
    else if (c.instance) c = c.instance;
    else break;
  }
  if (c.tag === "tuple") {
    for (const item of c.items) if (carries(item, seen)) return true;
  } else if (c.tag === "named") {
    for (const arg of c.args) if (carries(arg, seen)) return true;
  } else if (c.tag === "struct") {
    for (const field of c.fields) if (carries(field.type, seen)) return true;
  }
  return false;
}

function resolve(node: Ty): boolean {
  const seen = new Set<Ty>([node]);
  for (const dep of node.deps!) {
    if (carries(dep, seen)) {
      node.tainted = true;
      node.deps = undefined;
      return true;
    }
  }
  return false;
}

/** Read the outer `!` of one position. Clean, link-free types only follow their binding chain. */
export function isTainted(type: Ty): boolean {
  let c = type;
  while (true) {
    if (c.tainted) return true;
    if (c.tag === "view") {
      if (c.deps && resolve(c)) return true;
      c = c.value;
    } else if (c.tag === "var" || c.tag === "ffi") {
      if (c.deps && resolve(c)) return true;
      if (!c.instance) return false;
      c = c.instance;
    } else return false;
  }
}

/** Open variables in the order found. Sequences can collect thousands, so membership is indexed. */
type OpenList = { items: Ty[]; index?: Set<Ty>; seen?: Set<Ty> };

const newOpenList = (): OpenList => ({ items: [] });

function include(list: OpenList, t: Ty): void {
  if (list.index) {
    if (list.index.has(t)) return;
    list.index.add(t);
  } else {
    if (list.items.includes(t)) return;
    // Most lists stay short, and a scan beats building a set for them.
    if (list.items.length >= 16) list.index = new Set([...list.items, t]);
  }
  list.items.push(t);
}

/**
 * Collect the open variables of a type as a flat list, so a sequence of sequences links directly to
 * the variables and never to an earlier sequence. Returns true once a contained `!` is known.
 * Links walked for one member of a sequence aren't walked again for the next.
 */
function open(t: Ty, list: OpenList): boolean {
  let c = t;
  while (true) {
    if (c.tainted) return true;
    if (c.tag !== "view" && c.tag !== "var" && c.tag !== "ffi") break;
    if (c.deps) {
      list.seen ??= new Set();
      if (list.seen.has(c)) return false;
      list.seen.add(c);
      for (const dep of c.deps) if (open(dep, list)) return true;
    }
    if (c.tag === "view") c = c.value;
    else if ((c.tag === "var" || c.tag === "ffi") && c.instance) {
      if (c.linked) {
        include(list, c);
        return false;
      }
      c = c.instance;
    } else break;
  }
  if (c.tag === "var" || c.tag === "ffi") {
    c.linked = true;
    include(list, c);
  } else if (c.tag === "tuple") {
    for (const item of c.items) if (open(item, list)) return true;
  } else if (c.tag === "named") {
    for (const arg of c.args) if (open(arg, list)) return true;
  } else if (c.tag === "struct") {
    // A structural row can still gain fields, so the row itself stays open.
    if (carries(c)) return true;
    include(list, c);
  }
  return false;
}

/** Links still open, or undefined if one has resolved to `!`. Clean ones are dropped here. */
export function openDeps(deps: Ty[]): Ty[] | undefined {
  const list = newOpenList();
  for (const dep of deps) if (open(dep, list)) return undefined;
  return list.items;
}

export function taintedType(type: Ty, tainted = true): Ty {
  if (!tainted || type.tainted) return type;
  if (type.tag === "var" || type.tag === "ffi") {
    return { tag: "view", value: type, tainted: true, deps: undefined, linked: undefined };
  }
  return { ...type, tainted: true, deps: undefined };
}

/**
 * `(A!; B)` makes every member `!`. Only what ran before the result counts: a value's own contents
 * never give it an outer `!`, so `{ [1, eff()] }` stays `List<Number!>`. Members in `settled` already had their links recorded by whoever
 * bound them (a variable reference), so they contribute only what is known now.
 */
export function sequenceType(items: Ty[], result: Ty, settled?: Ty[]): Ty {
  if (settled) { for (const item of settled) if (carries(item)) return taintedType(result); }
  if (!items.length) return result;
  let list: OpenList | undefined;
  for (const item of items) {
    // Most members are clean concrete values: no list is needed to learn that.
    if (item.tag === "prim") {
      if (item.tainted) return taintedType(result);
      continue;
    }
    if (open(item, list ??= newOpenList())) return taintedType(result);
  }
  const deps = list?.items;
  if (!deps?.length) return result;
  const own = position(result);
  const links = deps.includes(own) ? deps.filter((dep) => dep !== own) : deps;
  if (!links.length) return result;
  return { tag: "view", value: result, deps: links, tainted: undefined, linked: undefined };
}

/** Local items keep their own shape and observe the enclosing sequence's `!`. */
export function sequenceView(sequence: Ty, member: Ty): Ty {
  if (sequence.tainted) return taintedType(member);
  if (!sequence.deps) return member;
  return { tag: "view", value: member, deps: [sequence], tainted: undefined, linked: undefined };
}

function mark(t: Ty): void {
  if (t.tag === "var" || t.tag === "ffi" || t.tag === "view") {
    t.tainted = true;
    t.deps = undefined;
  }
}

function link(a: Ty, b: Ty): void {
  (a.deps ??= []).push(b);
  (b.deps ??= []).push(a);
}

/** Set by readPosition: where a `!` on the type just read would be stored. */
let readAt: Ty;

/** One walk down a binding chain, reporting `!` and recording the position. */
function readPosition(type: Ty): boolean {
  let tainted = false;
  let view: Ty | undefined;
  let c = type;
  while (true) {
    if (c.tainted) tainted = true;
    if (c.tag === "view") {
      view ??= c;
      c = c.value;
    } else if ((c.tag === "var" || c.tag === "ffi") && c.instance) {
      const following: Ty = c.instance;
      if (following.tag !== "var" && following.tag !== "ffi" && following.tag !== "view") break;
      c = following;
    } else break;
  }
  readAt = view ?? c;
  return tainted;
}

/** unify(T, T!) is T!. Returns which sides were marked: 1 left, 2 right, 3 both, 0 neither. */
export function joinTypeTaints(left: Ty, right: Ty): number {
  if (left === right) return 0;
  const a = readPosition(left);
  const p = readAt;
  const b = readPosition(right);
  const q = readAt;
  if (a !== b) {
    mark(a ? q : p);
    return a ? 1 : 2;
  }
  if (a) return 3;
  if (p === q) return 0;
  // Only variables and views hold links, and a concrete side alone has nothing to share.
  if (!bindable(p) && p.tag !== "view") return 0;
  if (!bindable(q) && q.tag !== "view") return 0;
  if (!(p.deps || p.linked || q.deps || q.linked)) return 0;
  // An unbound variable is about to be bound to the other side, which already shares it.
  if (bindable(p) ? !next(p) : p.tag !== "view") return 0;
  if (bindable(q) ? !next(q) : q.tag !== "view") return 0;
  link(p, q);
  return 0;
}

/** Both sides are one variable already, so it takes over any link a view on the way held. */
export function absorbLinks(variable: Ty, left: Ty, right: Ty): void {
  for (const side of [left, right]) {
    for (let c: Ty | undefined = side; c && c !== variable; c = next(c)) {
      if (!c.deps) continue;
      for (const dep of c.deps) {
        if (dep !== variable && !(variable.deps ??= []).includes(dep)) variable.deps.push(dep);
      }
    }
  }
}

/** Replace what a bound position holds with the joined type, as HM binding replaces a variable. */
export function rebind(type: Ty, joined: Ty): void {
  let holder: Ty | undefined;
  for (let c: Ty | undefined = type; c; c = next(c)) {
    if (c.tag === "view" || bindable(c)) holder = c;
  }
  if (holder?.tag === "view") holder.value = joined;
  else if (holder?.tag === "var" || holder?.tag === "ffi") holder.instance = joined;
}

/** A position some variable holds was updated in place, so its parent must keep the reference. */
export function keepHeld(left: Ty, right: Ty, joined: Ty): Ty {
  if (left.tag === "var" || left.tag === "view" || left.tag === "ffi") return left;
  if (right.tag === "var" || right.tag === "view" || right.tag === "ffi") return right;
  return joined;
}

/** Keep the result's own `!` when an annotation changes its visible shape. */
export function preserveTaint(shape: Ty, original: Ty): Ty {
  if (shape === original) return shape;
  if (isTainted(original)) return taintedType(shape);
  const deps: Ty[] = [];
  for (let c: Ty | undefined = original; c; c = next(c)) {
    if (c.deps) deps.push(...c.deps);
    // The annotation's own node replaces a cell a caller's `!` would reach.
    if (c.linked && bindable(c) && !deps.includes(c)) deps.push(c);
  }
  return deps.length
    ? { tag: "view", value: shape, deps, tainted: undefined, linked: undefined }
    : shape;
}

/** Open the callback results of an expanded type, such as an alias, in parameter position. */
export function openCallbacks(type: Ty, parameter: boolean, fresh: () => Ty): void {
  if (type.tag === "fn") {
    for (const param of type.params) openCallbacks(param, !parameter, fresh);
    openCallbacks(type.result, parameter, fresh);
    if (parameter && type.result.tag !== "var") type.result = openPosition(fresh(), type.result);
  } else if (type.tag === "tuple") {
    for (const item of type.items) openCallbacks(item, parameter, fresh);
  } else if (type.tag === "named") {
    for (const arg of type.args) openCallbacks(arg, parameter, fresh);
  }
}

/**
 * A concrete function field has no type argument to record `!` in, so its open result counts as
 * evaluated when the value is built. A generic field keeps `!` in the value's own type instead.
 */
export function concreteFieldResults(callee: Ty): Ty[] {
  const out: Ty[] = [];
  const visit = (input: Ty): void => {
    let t = input;
    while (t.tag === "view" || ((t.tag === "var" || t.tag === "ffi") && t.instance)) {
      t = next(t)!;
    }
    if (t.tag === "fn") {
      for (let c: Ty | undefined = t.result; c; c = next(c)) {
        if (c.tag === "var" && c.linked && c.instance) {
          out.push(c);
          break;
        }
      }
      visit(t.result);
    } else if (t.tag === "tuple") t.items.forEach(visit);
    else if (t.tag === "named") t.args.forEach(visit);
  };
  let f = callee;
  while (f.tag === "view" || ((f.tag === "var" || f.tag === "ffi") && f.instance)) f = next(f)!;
  if (f.tag === "fn") f.params.forEach(visit);
  return out;
}

/**
 * What a constructor argument contributes when its field has no type argument to hold it. A generic
 * position keeps `!` in the value's type, so `Some(eff())` stays `Option<Number!>`, while a concrete
 * one can only mark the value: `Box(eff())` is `Box!`.
 */
export function concreteFieldInputs(field: Ty, value: Ty, out: Ty[]): void {
  if (field.tag === "var" || field.tag === "ffi" || field.tag === "view") return;
  const c = outerInputs(value, out);
  if (field.tag === "fn") {
    if (c.tag !== "fn") return;
    // A declared callback result is a cell around the concrete type, not a generic position.
    const end = chainEnd(field.result);
    concreteFieldInputs(
      (end as { instance?: Ty }).instance ?? end,
      c.result,
      out,
    );
    return;
  }
  const children = field.tag === "named" ? field.args : field.tag === "tuple" ? field.items : NONE;
  if (!children.length) {
    // The field binds any variable here, and a caller's `!` must still reach it.
    const end = chainEnd(value);
    if (bindable(end)) end.linked = true;
    out.push(value);
    return;
  }
  // A container's contents count only where its own field is concrete.
  const items = c.tag === "named" ? c.args : c.tag === "tuple" ? c.items : NONE;
  if (items.length !== children.length) return;
  children.forEach((child, index) => concreteFieldInputs(child, items[index], out));
}

/** Collect the `!` and links of one position, without its contents. Returns what it holds. */
export function outerInputs(value: Ty, out: Ty[]): Ty {
  let c = value;
  while (true) {
    if (c.tainted) out.push(c);
    if (c.deps) out.push(...c.deps);
    const following = next(c);
    if (!following) return c;
    c = following;
  }
}

/**
 * Keep a callback parameter's result open per instance, whatever it met in the body. A result can be
 * bound to a concrete type by the body (`if (c) { clean } else { f }`), and HM would then have no
 * variable left for a caller's `!` to reach. Only a parameter can later receive one.
 */
export function openInferredCallbacks(type: Ty, parameter: boolean, fresh: () => Ty): void {
  let t = type;
  while (t.tag === "view" || ((t.tag === "var" || t.tag === "ffi") && t.instance)) t = next(t)!;
  if (t.tag === "fn") {
    for (const param of t.params) openInferredCallbacks(param, !parameter, fresh);
    openInferredCallbacks(t.result, parameter, fresh);
    if (!parameter) return;
    const end = chainEnd(t.result);
    if (end.tag === "var" || end.tag === "ffi") {
      if (end.instance || (end.tag === "var" && end.numeric)) end.linked = true;
    } else if (end.tag !== "view") t.result = openPosition(fresh(), end);
  } else if (t.tag === "tuple") {
    for (const item of t.items) openInferredCallbacks(item, parameter, fresh);
  } else if (t.tag === "named") {
    for (const arg of t.args) openInferredCallbacks(arg, parameter, fresh);
  }
}

/** Annotated callback results are concrete but stay open per instance, like a variable. */
export function openPosition<T extends Ty>(variable: T, concrete: Ty): T {
  (variable as Ty & { instance?: Ty }).instance = concrete;
  variable.linked = true;
  return variable;
}
