import { assert, assertEquals } from "@std/assert";
import { checkSource } from "../src/compiler.ts";
import { parseCompilerModule } from "../src/compiler_frontend.ts";
import { inferModule } from "../src/infer.ts";
import { isTainted, sequenceType, sequenceView, taintedType } from "../src/taint.ts";
import {
  fn,
  fresh,
  freshFfi,
  generalize,
  instantiate,
  named,
  Real64Ty,
  prune,
  show,
  solveFfi,
  StringTy,
  structural,
  tuple,
  unify,
  VoidTy,
} from "../src/types.ts";
import { knownIssue } from "./known_issue.ts";

async function infer(source: string) {
  const module = await parseCompilerModule(source);
  return { module, result: inferModule(module) };
}

async function bindings(source: string) {
  const { result } = await infer(source);
  return Object.fromEntries([...result.exports].map(([name, scheme]) => [name, show(scheme.type)]));
}

async function checkedBindings(source: string) {
  const result = await checkSource(source);
  return Object.fromEntries([...result.exports].map(([name, scheme]) => [name, show(scheme.type)]));
}

Deno.test("discarded effects taint a local sequence, while top-level declarations stay independent", async () => {
  const { module, result } = await infer(`
    let outer = 7;
    let effect = () => { let early = outer; print("hello"); early; 1 };
    let scar = effect();
    let clean = outer + 1;
  `);
  assertEquals(show(result.exports.get("effect")!.type), "Void -> Int32.Int!");
  assertEquals(show(result.exports.get("scar")!.type), "Int32.Int!");
  assertEquals(show(result.exports.get("outer")!.type), "Int32.Int");
  assertEquals(show(result.exports.get("clean")!.type), "Int32.Int");
  const decl = module.decls[1];
  assert(decl.kind === "LetDecl");
  const lambda = decl.bindings[0].value;
  assert(lambda.kind === "Lambda" && lambda.body.kind === "Block");
  const early = lambda.body.items[0];
  assert(early.kind === "LetDecl");
  assert(isTainted(result.types.get(early.bindings[0].value)!));
  assert(isTainted(result.types.get(lambda.body.result)!));
});

Deno.test("HM instantiation preserves taint without contaminating clean uses", async () => {
  assertEquals(
    await bindings(`
    let id = (x) => { x };
    let effect = () => { print("hello"); 1 };
    let tainted = id(effect());
    let cleanNumber = id(2);
    let cleanString = id("clean");
  `),
    {
      id: "'a -> 'a",
      effect: "Void -> Int32.Int!",
      tainted: "Int32.Int!",
      cleanNumber: "Int32.Int",
      cleanString: "String",
    },
  );
});

Deno.test("concrete functions and higher-order functions preserve independent call taints", async () => {
  assertEquals(
    await bindings(`
    let increment = (x: Real64.Real) => { x + 1.0 };
    let apply = (f, x) => { f(x) };
    let effect = () => { print("hello"); 1.0 };
    let tainted = apply(effect, void);
    let derived = apply(increment, tainted);
    let clean = apply(increment, 2.0);
  `),
    {
      increment: "Real64.Real -> Real64.Real",
      apply: "('a -> 'b, 'a) -> 'b",
      effect: "Void -> Real64.Real!",
      tainted: "Real64.Real!",
      derived: "Real64.Real!",
      clean: "Real64.Real",
    },
  );
});

Deno.test("branches join effects and tainted conditions taint clean branch results", async () => {
  const types = await bindings(`
    let choose = (condition) => { if(condition) { print("hello"); 1 } else { 5 } };
    let condition = () => { print("hello"); true };
    let selected = if(condition()) { 1 } else { 2 };
    let clean = 3;
  `);
  assertEquals(types.choose, "Bool -> Int32.Int!");
  assertEquals(types.selected, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("latent lambda bodies do not execute during creation", async () => {
  assertEquals(
    await bindings(`
    let factory = () => { let f = () => { print("hello"); 1 }; 5 };
    let clean = factory();
    let outer = () => { print("hello"); () => { 1 } };
    let captured = outer();
    let scar = captured();
  `),
    {
      factory: "Void -> Int32.Int",
      clean: "Int32.Int",
      outer: "Void -> (Void -> Int32.Int)!",
      captured: "(Void -> Int32.Int)!",
      scar: "Int32.Int!",
    },
  );
});

Deno.test("destructuring and projection cannot wash taint out of an aggregate", async () => {
  const types = await bindings(`
    record Pair = { first: Real64.Real, second: String };
    let list = () => { print("hello"); [1, 2] };
    let values = list();
    let [head, ..tail] = values;
    let pair = () => { print("hello"); Pair(1, "two") };
    let value = pair();
    let field = value.first;
    let tuple = () => { print("hello"); (1, "two") };
    let (left, right) = tuple();
  `);
  assertEquals(types.head, "Int32.Int!");
  assertEquals(types.tail, "List<Int32.Int>!");
  assertEquals(types.field, "Real64.Real!");
  assertEquals(types.left, "Int32.Int!");
  assertEquals(types.right, "String!");
});

Deno.test("foreign calls stay effectful through aliases and ordinary annotations", async () => {
  const types = await bindings(`
    from js.global("Deno") import unsafe { clock: Void -> Real64.Real };
    let alias = clock;
    let effect: Void -> Real64.Real = () => { clock() };
    let direct = alias();
    let annotated = effect();
    let clean = 1;
  `);
  assertEquals(types.alias, "Void -> Real64.Real!");
  assertEquals(types.direct, "Real64.Real!");
  assertEquals(types.annotated, "Real64.Real!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("recursive taint propagation terminates and reaches callers", async () => {
  const types = await bindings(`
    let rec loop = (n) => {
      if(n == 0) { print("done"); 1 } else { loop(n - 1) }
    };
    let tainted = loop(2);
    let clean = 1;
  `);
  assertEquals(types.tainted, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("tainting one primitive occurrence does not mutate the shared primitive", () => {
  assertEquals(show(taintedType(Real64Ty)), "Real64.Real!");
  assertEquals(show(Real64Ty), "Real64.Real");
});

Deno.test("discarded callback results remain connected to HM substitutions", async () => {
  const types = await bindings(`
    let run = (f) => { f(); 1 };
    let effect = () => { print("hello"); 5 };
    let scar = run(effect);
    let clean = run(() => { 5 });
  `);
  assertEquals(types.scar, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("element taint and sequence taint occupy separate list type positions", async () => {
  const types = await bindings(`
    let effect = () => { print("hello"); 1 };
    let sequence = () => { effect(); [1, effect()] };
    let elements = () => { [1, effect()] };
    let reversed = () => { [effect(), 1] };
  `);
  assertEquals(types.sequence, "Void -> List<Int32.Int!>!");
  assertEquals(types.elements, "Void -> List<Int32.Int!>");
  assertEquals(types.reversed, "Void -> List<Int32.Int!>");
});

Deno.test("function arguments hide taint while callback return types retain it", () => {
  const scar = taintedType(Real64Ty);
  assertEquals(show(fn([scar], Real64Ty)), "Real64.Real -> Real64.Real");
  assertEquals(show(fn([fn([VoidTy], scar)], scar)), "(Void -> Real64.Real!) -> Real64.Real!");
});

Deno.test("HM substitution preserves the symbolic summary of a discarded result", () => {
  const source = fresh();
  const result = sequenceType([source], Real64Ty);
  const alias = fresh();
  unify(alias, result);
  prune(alias);
  unify(source, taintedType(Real64Ty));
  assertEquals(show(alias), "Real64.Real!");
});

Deno.test("concrete callback annotations and captured callbacks retain sequencing taint", async () => {
  const types = await bindings(`
    let effect = () => { print("hello"); 5.0 };
    let run = (f: Void -> Real64.Real) => { f(); 1.0 };
    let make = (f: Void -> Real64.Real) => {
      let inner = () => { f(); 1.0 };
      inner
    };
    let direct = run(effect);
    let closure = make(effect);
    let captured = closure();
    let clean = run(() => { 5.0 });
  `);
  assertEquals(types.direct, "Real64.Real!");
  assertEquals(types.captured, "Real64.Real!");
  assertEquals(types.clean, "Real64.Real");
});

Deno.test("discarded tuples and nested lists propagate contained taint into a sequence", async () => {
  const types = await bindings(`
    let effect ==> { print "a"; 1 };
    let tuple ==> { let y = (effect(), 1); 1 };
    let list ==> { let y = [1, effect()]; 1 };
    let nested ==> { let y = ([1, effect()], (2, 3)); 1 };
    let tupleValue = tuple();
    let listValue = list();
    let nestedValue = nested();
    let clean = 1;
  `);
  assertEquals(types.tuple, "Void -> Int32.Int!");
  assertEquals(types.list, "Void -> Int32.Int!");
  assertEquals(types.nested, "Void -> Int32.Int!");
  assertEquals(types.tupleValue, "Int32.Int!");
  assertEquals(types.listValue, "Int32.Int!");
  assertEquals(types.nestedValue, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("contained lambdas stay latent but tainted function values propagate", async () => {
  const types = await bindings(`
    let effect ==> { print "a"; 1 };
    let tuple ==> { let y = (() => { effect() }, 1); 1 };
    let list ==> { let y = [() => { effect() }]; 1 };
    let factory ==> { print "created"; () => { 1 } };
    let produced ==> { let y = (factory(), 1); 1 };
    let invoked ==> { let y = (() => { effect() }, 1); let (f, _) = y; f(); 1 };
  `);
  assertEquals(types.tuple, "Void -> Int32.Int");
  assertEquals(types.list, "Void -> Int32.Int");
  assertEquals(types.produced, "Void -> Int32.Int!");
  assertEquals(types.invoked, "Void -> Int32.Int!");
});

Deno.test("higher-order sequencing follows tainted data without evaluating callback bodies", async () => {
  const types = await bindings(`
    let effect ==> { print "a"; 1 };
    let discard = (f) => { let y = f(); 1 };
    let eager = discard(() => { (effect(), 1) });
    let latent = discard(() => { (() => { effect() }, 1) });
  `);
  assertEquals(types.eager, "Int32.Int!");
  assertEquals(types.latent, "Int32.Int");
});

Deno.test("substitution resolves nested returned closures before they are called", async () => {
  const types = await bindings(`
    let effect = () => { print("x"); 1 };
    let make = (f) => { () => { f(); 1 } };
    let closure = make(effect);
    let clean = make(() => { 1 });
    let boxed = (f) => { [() => { f(); 1 }] };
    let values = boxed(effect);
    let cleanValues = boxed(() => { 1 });
  `);
  assertEquals(types.closure, "Void -> Int32.Int!");
  assertEquals(types.clean, "Void -> Int32.Int");
  assertEquals(types.values, "List<Void -> Int32.Int!>");
  assertEquals(types.cleanValues, "List<Void -> Int32.Int>");
});

Deno.test("mutually recursive bindings resolve taint after the entire group is inferred", async () => {
  const types = await bindings(`
    let rec first = () => { second(); 1 }
    and second = () => { print("x"); 1 };
  `);
  assertEquals(types.first, "Void -> Int32.Int!");
  assertEquals(types.second, "Void -> Int32.Int!");
});

Deno.test("ordinary tuple positions stay independent while sequence tuple members share taint", () => {
  const scar = taintedType(Real64Ty);
  const ordinary = tuple([scar, StringTy]);
  assertEquals(show(ordinary), "(Real64.Real!, String)");
  assertEquals(isTainted(ordinary), false);
  assertEquals(show(sequenceType([scar], StringTy)), "String!");
  assertEquals(show(StringTy), "String");
});

Deno.test("late sequence taint preserves a returned ordinary tuple's shape", async () => {
  const types = await bindings(`
    let effect = () => { print("x"); 1 };
    let run = (f) => { f(); (1, "text", true) };
    let value = run(effect);
    let clean = run(() => { 1 });
    let (number, text, flag) = value;
  `);
  assertEquals(types.value, "(Int32.Int, String, Bool)!");
  assertEquals(types.clean, "(Int32.Int, String, Bool)");
  assertEquals(types.number, "Int32.Int!");
  assertEquals(types.text, "String!");
  assertEquals(types.flag, "Bool!");
});

Deno.test("unification joins scars by replacing what a variable holds, without touching a sibling", () => {
  const number = fresh();
  unify(number, Real64Ty);
  unify(number, taintedType(Real64Ty));
  assertEquals(show(number), "Real64.Real!");
  const ordinary = tuple([number, StringTy]);
  assertEquals(show(ordinary), "(Real64.Real!, String)");
  assertEquals(show(StringTy), "String");
  assertEquals(show(unify(Real64Ty, taintedType(Real64Ty))!), "Real64.Real!");
  assertEquals(show(Real64Ty), "Real64.Real");
});

Deno.test("a sequence summary observes late source unification", () => {
  const source = fresh();
  const sequence = sequenceType([source], StringTy);
  const firstView = sequenceView(sequence, source);
  unify(source, taintedType(Real64Ty));
  // No extra unification or type-reading traversal is needed to resolve the sequence.
  assertEquals(isTainted(sequence), true);
  assertEquals(show(sequence), "String!");
  assertEquals(show(firstView), "Real64.Real!");
  assertEquals(show(StringTy), "String");
});

Deno.test("unifying a sequence alias spreads an incoming scar to all sequence views", () => {
  const source = fresh();
  const sequence = sequenceType([source], Real64Ty);
  const firstView = sequenceView(sequence, source);
  const alias = fresh();
  unify(alias, sequence);
  prune(alias);
  unify(alias, taintedType(Real64Ty));
  assertEquals(isTainted(firstView), true);
  assertEquals(show(alias), "Real64.Real!");
  assertEquals(show(Real64Ty), "Real64.Real");
});

Deno.test("eliminators preserve effects in evaluated inputs whose values are discarded", async () => {
  const types = await bindings(`
    let effect = () => { print("x"); 1 };
    let condition = () => { print("x"); true };
    let fst = (pair) => { let (first, _) = pair; first };
    let constant = (first, _) => { first };
    let ignore = (_) => { void };
    let projected = fst((1, effect()));
    let discarded = constant(1, effect());
    let ignored = ignore(effect());
    let selected = if(condition()) { 1 } else { 2 };
    let clean = constant(1, 2);
  `);
  assertEquals(types.projected, "Int32.Int!");
  assertEquals(types.discarded, "Int32.Int!");
  assertEquals(types.ignored, "Void!");
  assertEquals(types.selected, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("late substitutions summarize nested containers and retain independent siblings", async () => {
  const types = await bindings(`
    let effect = () => { print("x"); 1 };
    let nested = (f) => { (((f(), "text"), true), 2) };
    let discard = (f) => { let value = (((f(), "text"), true), 2); 1 };
    let value = nested(effect);
    let scar = discard(effect);
    let clean = discard(() => { 1 });
  `);
  assertEquals(types.value, "(((Int32.Int!, String), Bool), Int32.Int)");
  assertEquals(types.scar, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("nested tuple construction summarizes contained scars separately from outer scars", () => {
  const inner = tuple([taintedType(Real64Ty), StringTy]);
  const outer = tuple([tuple([inner, StringTy]), StringTy]);
  assertEquals(show(outer), "(((Real64.Real!, String), String), String)");
  assertEquals(isTainted(outer), false);
  assertEquals(show(sequenceType([outer], Real64Ty)), "Real64.Real!");
});

Deno.test("late taint reaches branching container summaries without merging their tuple positions", () => {
  const source = fresh();
  const left = tuple([source, StringTy]);
  const right = tuple([tuple([source, StringTy]), StringTy]);
  const leftResult = sequenceType([left], StringTy);
  const rightResult = sequenceType([right], Real64Ty);
  unify(source, taintedType(Real64Ty));
  assertEquals(show(left), "(Real64.Real!, String)");
  assertEquals(show(right), "((Real64.Real!, String), String)");
  assertEquals(show(leftResult), "String!");
  assertEquals(show(rightResult), "Real64.Real!");
});

Deno.test("symbolic summaries terminate across alias cycles and a deep chain of joins", () => {
  const source = fresh();
  const alias = fresh();
  unify(source, alias);
  unify(alias, source);
  let result = source;
  for (let i = 0; i < 10000; i++) result = sequenceType([result], { ...Real64Ty });
  unify(alias, taintedType(Real64Ty));
  assertEquals(isTainted(result), true);
});

Deno.test("instantiation preserves late links through unified variables", () => {
  const parameter = fresh();
  const discarded = fresh();
  const intermediate = fresh();
  unify(parameter, intermediate);
  unify(intermediate, discarded);
  const signature = fn([parameter], sequenceType([discarded], { ...StringTy }));
  assert(signature.tag === "fn");
  const scheme = generalize(new Map(), signature);
  const scar = instantiate(scheme);
  const clean = instantiate(scheme);
  assert(scar.tag === "fn" && clean.tag === "fn");
  unify(scar.params[0], taintedType(Real64Ty));
  assertEquals(show(scar.result), "String!");
  assertEquals(show(clean.result), "String");
  assertEquals(show(signature.result), "String");
});

Deno.test("symbolic summaries terminate when a discarded member refers back to the sequence", () => {
  const source = fresh();
  const result = sequenceType([source], { ...StringTy });
  unify(source, result);
  unify(source, taintedType(StringTy));
  assertEquals(show(result), "String!");
  assertEquals(show(source), "String!");
});

Deno.test("new structural record fields extend the existing contained summary", () => {
  const source = fresh();
  const record = structural([]);
  const result = sequenceType([record], { ...StringTy });
  unify(record, structural([{ name: "value", type: source }]));
  unify(source, taintedType(Real64Ty));
  assertEquals(show(result), "String!");
  assertEquals(isTainted(record), false);
});

Deno.test("solving an FFI placeholder binds its contained summary", () => {
  const placeholder = freshFfi("get", undefined, ["value"]);
  const result = sequenceType([placeholder], { ...StringTy });
  const source = fresh();
  solveFfi(placeholder, tuple([source, StringTy]));
  unify(source, taintedType(Real64Ty));
  assertEquals(show(result), "String!");
  assertEquals(show(placeholder), "(Real64.Real!, String)");
});

Deno.test("a sequence view shares its symbolic summary with its consumers", () => {
  const source = fresh();
  const sequence = sequenceType([source], { ...StringTy });
  const view = sequenceView(sequence, StringTy);
  const consumer = sequenceType([view], { ...Real64Ty });
  unify(source, taintedType(Real64Ty));
  assertEquals(show(view), "String!");
  assertEquals(show(consumer), "Real64.Real!");
});

Deno.test("copying a bound HM alias preserves the contained summary of its value type", () => {
  const element = fresh();
  const aggregate = tuple([element, StringTy]);
  const alias = fresh();
  unify(alias, aggregate);
  const signature = fn([element], alias);
  const instance = instantiate(generalize(new Map(), signature));
  assert(instance.tag === "fn");
  const discarded = sequenceType([instance.result], StringTy);
  unify(instance.params[0], taintedType(Real64Ty));
  assertEquals(show(discarded), "String!");
});

Deno.test("sequence summaries retain no discarded value shapes", () => {
  const discarded = tuple([
    tuple([Real64Ty, StringTy]),
    fn([tuple([StringTy, Real64Ty])], tuple([Real64Ty, StringTy])),
  ]);
  const result = sequenceType([discarded], StringTy);
  assert(result.tag === "prim");
  assertEquals(result.name, "String");
  assertEquals(show(result), "String");
  assertEquals(result, StringTy);
});

Deno.test("generalized local closures preserve captured summaries across independent calls", async () => {
  const types = await bindings(`
    let effect = () => { print("x"); 1 };
    let relay = (f) => {
      let alias = f;
      let thunk = () => { alias(); 1 };
      thunk
    };
    let scar = relay(effect);
    let clean = relay(() => { 1 });
  `);
  assertEquals(types.scar, "Void -> Int32.Int!");
  assertEquals(types.clean, "Void -> Int32.Int");
});

Deno.test("a generic function types a rebuilt container exactly like the inlined match", async () => {
  const types = await bindings(`
    type R<A,E> = | Good<A> | Bad<E>;
    let map = (r, f) => { match(r) {
      Good(x) => { Good(f(x)) },
      Bad(e) => { Bad(e) }
    } };
    let make = () => { print("x"); Good(1) };
    let original = make();
    let direct = match(original) { Good(x) => { Good(x + 1) }, Bad(e) => { Bad(e) } };
    let value = map(original, (x) => { x + 1 });
    let clean = map(Good(2), (x) => { x + 1 });
  `);
  assertEquals(types.original, "R<Int32.Int, 'a>!");
  assertEquals(types.direct, "R<Int32.Int, 'a>!");
  assertEquals(types.value, "R<Int32.Int, 'a>!");
  assertEquals(types.clean, "R<Int32.Int, 'a>");
});

Deno.test("adding an outer scar to a sequence result does not mark its dependency", () => {
  const source = fresh();
  const result = sequenceType([source], { ...StringTy });
  unify(result, taintedType(StringTy));
  assertEquals(show(result), "String!");
  assert(!isTainted(source));
});

Deno.test("outer and inner taint stay distinct through signatures and calls", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1 };
    let both ==> { eff(); [1, eff()] };
    let inner ==> { [1, eff()] };
    let outer ==> { eff(); [1, 2] };
    let bothValue = both();
    let innerValue = inner();
    let outerValue = outer();
    let element = match(inner()) { Cons(h, t) => { h }, Nil => { 0 } };
    let outerElement = match(outer()) { Cons(h, t) => { h }, Nil => { 0 } };
  `);
  assertEquals(types.both, "Void -> List<Int32.Int!>!");
  assertEquals(types.inner, "Void -> List<Int32.Int!>");
  assertEquals(types.outer, "Void -> List<Int32.Int>!");
  assertEquals(types.bothValue, "List<Int32.Int!>!");
  assertEquals(types.innerValue, "List<Int32.Int!>");
  assertEquals(types.outerValue, "List<Int32.Int>!");
  assertEquals(types.element, "Int32.Int!");
  assertEquals(types.outerElement, "Int32.Int!");
});

Deno.test("concrete function types absorb a joined scar through variables and results", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1.0 };
    let clean: Void -> Real64.Real = () => { 1.0 };
    let held: Void -> Real64.Real = eff;
    let heldValue = held();
    type Cb = Void -> Real64.Real;
    let run = (f: Cb) => { f(); 1.0 };
    let aliased = run(eff);
    let pureAliased = run(() => { 1.0 });
    let choose = (c) => { if (c) { clean } else { eff } };
    let branch = choose(true)();
    let cleanAfter = clean();
    let list = [clean, eff];
    let element = match(list) { [a, b] => { a() }, _ => { 1.0 } };
    let positions = (c) => { if (c) { (1.0, "a") } else { (eff(), "b") } };
  `);
  assertEquals(types.heldValue, "Real64.Real!");
  assertEquals(types.aliased, "Real64.Real!");
  assertEquals(types.pureAliased, "Real64.Real");
  assertEquals(types.branch, "Real64.Real!");
  assertEquals(types.cleanAfter, "Real64.Real");
  assertEquals(types.element, "Real64.Real!");
  assertEquals(types.positions, "Bool -> (Real64.Real!, String)");
});

Deno.test("a recursive function's callback reaches its result", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1 };
    let rec go = (f, n) => { if (n < 1) { 1 } else { f(); go(f, n - 1) } };
    let scar = go(eff, 3);
    let clean = go(() => { 2 }, 3);
  `);
  assertEquals(types.scar, "Int32.Int!");
  assertEquals(types.clean, "Int32.Int");
});

Deno.test("a concrete function field marks the value that holds it", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1.0 };
    let pure = () => { 1.0 };
    type H = | H<Void -> Real64.Real>;
    record Holder = { f: Void -> Real64.Real, n: Real64.Real };
    let scar = H(eff);
    let clean = H(pure);
    let called = match(H(eff)) { H(f) => { f() } };
    let cleanCalled = match(H(pure)) { H(f) => { f() } };
    let wrap = (x) => { H(x) };
    let lateScar = wrap(eff);
    let lateClean = wrap(pure);
    let record = Holder(eff, 1.0);
    let recordClean = Holder(pure, 1.0);
    let generic = Some(eff);
  `);
  assertEquals(types.scar, "H!");
  assertEquals(types.clean, "H");
  assertEquals(types.called, "Real64.Real!");
  assertEquals(types.cleanCalled, "Real64.Real");
  assertEquals(types.lateScar, "H!");
  assertEquals(types.lateClean, "H");
  assertEquals(types.record, "Holder!");
  assertEquals(types.recordClean, "Holder");
  assertEquals(types.generic, "Option<Void -> Real64.Real!>");
});

Deno.test("a concrete data field marks the value, and a generic one keeps the mark inside", async () => {
  const types = await bindings(`
    let eff = () => { print("x"); 1.0 };
    let clean = () => 1.0;
    type Box = | Box<Real64.Real>;
    type Lst = | Lst<List<Real64.Real>>;
    type Mix<T> = | Mix<T, Real64.Real>;
    type Gen<T> = | Gen<List<T>>;
    record P = { a: Real64.Real, b: String };
    record G<T> = { v: T, n: Real64.Real };
    record C = { f: Void -> Real64.Real };
    record D<T> = { f: Void -> T };
    let box = Box(eff());
    let list = Lst([eff()]);
    let mixConcrete = Mix(1.0, eff());
    let mixGeneric = Mix(eff(), 1.0);
    let gen = Gen([eff()]);
    let record = P(eff(), "s");
    let literal = .{ a = eff(), b = "s" };
    let genericLiteral = .{ v = eff(), n = 1.0 };
    let concreteLiteral: G<Real64.Real> = .{ v = 1.0, n = eff() };
    let spread = .{ ..literal, b = "t" };
    let functionField = .{ f = eff };
    let cleanFunctionField = .{ f = clean };
    let genericFunctionField: D<Real64.Real> = .{ f = eff };
    let extracted = () => { match(Box(eff())) { Box(x) => { x } } };
    let sibling = () => { let p = P(eff(), "s"); p.b };
    let viaCallback = (g) => { Box(g()) };
    let tainted = viaCallback(eff);
    let untainted = viaCallback(clean);
  `);
  assertEquals(types.box, "Box!");
  assertEquals(types.list, "Lst!");
  assertEquals(types.mixConcrete, "Mix<Real64.Real>!");
  assertEquals(types.mixGeneric, "Mix<Real64.Real!>");
  assertEquals(types.gen, "Gen<Real64.Real!>");
  assertEquals(types.record, "P!");
  assertEquals(types.literal, "P!");
  assertEquals(types.genericLiteral, "G<Real64.Real!>");
  assertEquals(types.concreteLiteral, "G<Real64.Real>!");
  assertEquals(types.spread, "P!");
  assertEquals(types.functionField, "C!");
  assertEquals(types.cleanFunctionField, "C");
  // D's field is generic, so the mark stays inside, as for `genericLiteral`; the annotation
  // changes nothing.
  assertEquals(types.genericFunctionField, "D<Real64.Real!>");
  assertEquals(types.extracted, "Void -> Real64.Real!");
  assertEquals(types.sibling, "Void -> String!");
  assertEquals(types.tainted, "Box!");
  assertEquals(types.untainted, "Box");
});

Deno.test("a discarded call taints through a callback whose own result is concrete", async () => {
  const types = await checkedBindings(`
    let effect = x => { print("hello"); x + 1 };
    let clean = x => x + 1;
    let call = g => { g(1) };
    let listOf = g => { [g(1)] };
    let wrapped = f => { call(x => { f(x); 2 }); 1 };
    let collected = f => { listOf(x => { f(x); void }); 1 };
    let named = f => { let g = x => { f(x); void }; call(g); 1 };
    let mapIgnore = (xs, f) => { xs :> map(x => { f(x); void }); [1, 2, 3] };
    let wrappedEffect = wrapped(effect);
    let wrappedClean = wrapped(clean);
    let collectedEffect = collected(effect);
    let namedEffect = named(effect);
    let mappedEffect = mapIgnore([1, 2], effect);
    let mappedClean = mapIgnore([1, 2], clean);
    let mappedEffectAgain = mapIgnore([1, 2], effect);
  `);
  assertEquals(types.wrappedEffect, "Int32.Int!");
  assertEquals(types.wrappedClean, "Int32.Int");
  assertEquals(types.collectedEffect, "Int32.Int!");
  assertEquals(types.namedEffect, "Int32.Int!");
  assertEquals(types.mappedEffect, "List<Int32.Int>!");
  // One caller's `!` stays with that caller.
  assertEquals(types.mappedClean, "List<Int32.Int>");
  assertEquals(types.mappedEffectAgain, "List<Int32.Int>!");
});

Deno.test("a callback result stays open after meeting a concrete type in the body", async () => {
  const types = await bindings(`
    let eff = () => { print("x"); 1 };
    let clean = () => 1;
    type Opt<T> = | None | Some<T>;
    let literal = (f) => { if (true) { f() } else { 0 } };
    let a = literal(eff);
    let b = literal(clean);
    let nested = (o) => { match(o) { Some(f) => { f() }, None => { 0 } } };
    let c = nested(Some(eff));
    let d = nested(Some(clean));
    let joined = (x, f) => { if (x) { clean } else { f } };
    let e = joined(true, eff)();
    let g = joined(true, clean)();
  `);
  assertEquals(types.a, "Int32.Int!");
  assertEquals(types.b, "Int32.Int");
  assertEquals(types.c, "Int32.Int!");
  assertEquals(types.d, "Int32.Int");
  assertEquals(types.e, "Int32.Int!");
  assertEquals(types.g, "Int32.Int");
});

Deno.test("a return annotation keeps the positions a caller's taint reaches", async () => {
  const types = await bindings(`
    let eff = () => { print("x"); 1.0 };
    let clean = () => 1.0;
    let value = (f: Void -> Real64.Real): Real64.Real => { f() };
    let a = value(eff);
    let b = value(clean);
    let same = (f: Void -> Real64.Real): (Void -> Real64.Real) => { f };
    let c = same(eff)();
    let d = same(clean)();
    let list = (f: Void -> Real64.Real): List<Real64.Real> => { [f()] };
    let e = list(eff);
    let g = list(clean);
  `);
  assertEquals(types.a, "Real64.Real!");
  assertEquals(types.b, "Real64.Real");
  assertEquals(types.c, "Real64.Real!");
  assertEquals(types.d, "Real64.Real");
  assertEquals(types.e, "List<Real64.Real!>");
  assertEquals(types.g, "List<Real64.Real>");
});

Deno.test("a callback result stays open when an operator in the body makes it concrete", async () => {
  const types = await bindings(`
    let eff = (i) => { print("x"); i };
    let clean = (i) => { i };
    let number = f => { f(1) + 1 };
    let a = number(eff);
    let b = number(clean);
    let text = f => { f("s") ++ "t" };
    let c = text(eff);
    let d = text(clean);
    let compare = f => { f("s") == "t" };
    let e = compare(eff);
    let g = compare(clean);
    let branch = f => { if (f(true)) { 1 } else { 2 } };
    let h = branch(eff);
    let i = branch(clean);
    let rec loop = (k, n) => { if (n == 0) { k("s") ++ "t" } else { loop(k, n - 1) } };
    let j = loop(eff, 1);
    let l = loop(clean, 1);
  `);
  assertEquals(types.a, "Int32.Int!");
  assertEquals(types.b, "Int32.Int");
  assertEquals(types.c, "String!");
  assertEquals(types.d, "String");
  assertEquals(types.e, "Bool!");
  assertEquals(types.g, "Bool");
  assertEquals(types.h, "Int32.Int!");
  assertEquals(types.i, "Int32.Int");
  assertEquals(types.j, "String!");
  assertEquals(types.l, "String");
});

const pureLibraryCalls = `
  let byte = Word8.fromReal64(260);
  let chars = String.toList("ab");
  let task = Task.succeed(1);
  let parsed = Monad.via Task (login) => { login :> Task.succeed };
`;

Deno.test({
  name: "[known issue: pure-std-primitives-carry-effect-taint] pure library calls stay clean",
  ignore: knownIssue("pure-std-primitives-carry-effect-taint"),
  async fn() {
    const { env } = await checkSource(pureLibraryCalls);
    const type = (name: string) => show(env.get(name)!.type);
    assertEquals(type("byte"), "Word8.Word");
    assertEquals(type("chars"), "List<String>");
    assertEquals(type("task"), "Task<Real64.Real, 'a>");
    assertEquals(type("parsed"), "Task<'a, 'b> -> Task<'a, 'b>");
  },
});

Deno.test("destructuring keeps a generic component's taint", async () => {
  const types = await bindings(`
    let eff = () => { print("x"); 1 };
    let clean = () => { 1 };
    let first = (p) => { let (a, b) = p; [a] };
    let tainted = first((eff(), 2));
    let untainted = first((clean(), 2));
  `);
  assertEquals(types.tainted, "List<Int32.Int!>!");
  assertEquals(types.untainted, "List<Int32.Int>");
});
