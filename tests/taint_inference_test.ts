import { assert, assertEquals } from "@std/assert";
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
  NumberTy,
  prune,
  show,
  solveFfi,
  StringTy,
  structural,
  tuple,
  unify,
  VoidTy,
} from "../src/types.ts";

async function infer(source: string) {
  const module = await parseCompilerModule(source);
  return { module, result: inferModule(module) };
}

async function bindings(source: string) {
  const { result } = await infer(source);
  return Object.fromEntries([...result.exports].map(([name, scheme]) => [name, show(scheme.type)]));
}

Deno.test("discarded effects taint a local sequence, while top-level declarations stay independent", async () => {
  const { module, result } = await infer(`
    let outer = 7;
    let effect = () => { let early = outer; print("hello"); early; 1 };
    let scar = effect();
    let clean = outer + 1;
  `);
  assertEquals(show(result.exports.get("effect")!.type), "Void -> Number!");
  assertEquals(show(result.exports.get("scar")!.type), "Number!");
  assertEquals(show(result.exports.get("outer")!.type), "Number");
  assertEquals(show(result.exports.get("clean")!.type), "Number");
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
      effect: "Void -> Number!",
      tainted: "Number!",
      cleanNumber: "Number",
      cleanString: "String",
    },
  );
});

Deno.test("concrete functions and higher-order functions preserve independent call taints", async () => {
  assertEquals(
    await bindings(`
    let increment = (x: Number) => { x + 1 };
    let apply = (f, x) => { f(x) };
    let effect = () => { print("hello"); 1 };
    let tainted = apply(effect, void);
    let derived = apply(increment, tainted);
    let clean = apply(increment, 2);
  `),
    {
      increment: "Number -> Number",
      apply: "('a -> 'b, 'a) -> 'b",
      effect: "Void -> Number!",
      tainted: "Number!",
      derived: "Number!",
      clean: "Number",
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
  assertEquals(types.choose, "Bool -> Number!");
  assertEquals(types.selected, "Number!");
  assertEquals(types.clean, "Number");
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
      factory: "Void -> Number",
      clean: "Number",
      outer: "Void -> (Void -> Number)!",
      captured: "(Void -> Number)!",
      scar: "Number!",
    },
  );
});

Deno.test("destructuring and projection cannot wash taint out of an aggregate", async () => {
  const types = await bindings(`
    record Pair = { first: Number, second: String };
    let list = () => { print("hello"); [1, 2] };
    let values = list();
    let [head, ..tail] = values;
    let pair = () => { print("hello"); Pair(1, "two") };
    let value = pair();
    let field = value.first;
    let tuple = () => { print("hello"); (1, "two") };
    let (left, right) = tuple();
  `);
  assertEquals(types.head, "Number!");
  assertEquals(types.tail, "List<Number>!");
  assertEquals(types.field, "Number!");
  assertEquals(types.left, "Number!");
  assertEquals(types.right, "String!");
});

Deno.test("foreign calls stay effectful through aliases and ordinary annotations", async () => {
  const types = await bindings(`
    from js.global("Deno") import unsafe { clock: Void -> Number };
    let alias = clock;
    let effect: Void -> Number = () => { clock() };
    let direct = alias();
    let annotated = effect();
    let clean = 1;
  `);
  assertEquals(types.alias, "Void -> Number!");
  assertEquals(types.direct, "Number!");
  assertEquals(types.annotated, "Number!");
  assertEquals(types.clean, "Number");
});

Deno.test("recursive taint propagation terminates and reaches callers", async () => {
  const types = await bindings(`
    let rec loop = (n) => {
      if(n == 0) { print("done"); 1 } else { loop(n - 1) }
    };
    let tainted = loop(2);
    let clean = 1;
  `);
  assertEquals(types.tainted, "Number!");
  assertEquals(types.clean, "Number");
});

Deno.test("tainting one primitive occurrence does not mutate the shared primitive", () => {
  assertEquals(show(taintedType(NumberTy)), "Number!");
  assertEquals(show(NumberTy), "Number");
});

Deno.test("discarded callback results remain connected to HM substitutions", async () => {
  const types = await bindings(`
    let run = (f) => { f(); 1 };
    let effect = () => { print("hello"); 5 };
    let scar = run(effect);
    let clean = run(() => { 5 });
  `);
  assertEquals(types.scar, "Number!");
  assertEquals(types.clean, "Number");
});

Deno.test("element taint and sequence taint occupy separate list type positions", async () => {
  const types = await bindings(`
    let effect = () => { print("hello"); 1 };
    let sequence = () => { effect(); [1, effect()] };
    let elements = () => { [1, effect()] };
    let reversed = () => { [effect(), 1] };
  `);
  assertEquals(types.sequence, "Void -> List<Number!>!");
  assertEquals(types.elements, "Void -> List<Number!>");
  assertEquals(types.reversed, "Void -> List<Number!>");
});

Deno.test("function arguments hide taint while callback return types retain it", () => {
  const scar = taintedType(NumberTy);
  assertEquals(show(fn([scar], NumberTy)), "Number -> Number");
  assertEquals(show(fn([fn([VoidTy], scar)], scar)), "(Void -> Number!) -> Number!");
});

Deno.test("HM substitution preserves the symbolic summary of a discarded result", () => {
  const source = fresh();
  const result = sequenceType([source], NumberTy);
  const alias = fresh();
  unify(alias, result);
  prune(alias);
  unify(source, taintedType(NumberTy));
  assertEquals(show(alias), "Number!");
});

Deno.test("concrete callback annotations and captured callbacks retain sequencing taint", async () => {
  const types = await bindings(`
    let effect = () => { print("hello"); 5 };
    let run = (f: Void -> Number) => { f(); 1 };
    let make = (f: Void -> Number) => {
      let inner = () => { f(); 1 };
      inner
    };
    let direct = run(effect);
    let closure = make(effect);
    let captured = closure();
    let clean = run(() => { 5 });
  `);
  assertEquals(types.direct, "Number!");
  assertEquals(types.captured, "Number!");
  assertEquals(types.clean, "Number");
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
  assertEquals(types.tuple, "Void -> Number!");
  assertEquals(types.list, "Void -> Number!");
  assertEquals(types.nested, "Void -> Number!");
  assertEquals(types.tupleValue, "Number!");
  assertEquals(types.listValue, "Number!");
  assertEquals(types.nestedValue, "Number!");
  assertEquals(types.clean, "Number");
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
  assertEquals(types.tuple, "Void -> Number");
  assertEquals(types.list, "Void -> Number");
  assertEquals(types.produced, "Void -> Number!");
  assertEquals(types.invoked, "Void -> Number!");
});

Deno.test("higher-order sequencing follows tainted data without evaluating callback bodies", async () => {
  const types = await bindings(`
    let effect ==> { print "a"; 1 };
    let discard = (f) => { let y = f(); 1 };
    let eager = discard(() => { (effect(), 1) });
    let latent = discard(() => { (() => { effect() }, 1) });
  `);
  assertEquals(types.eager, "Number!");
  assertEquals(types.latent, "Number");
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
  assertEquals(types.closure, "Void -> Number!");
  assertEquals(types.clean, "Void -> Number");
  assertEquals(types.values, "List<Void -> Number!>");
  assertEquals(types.cleanValues, "List<Void -> Number>");
});

Deno.test("mutually recursive bindings resolve taint after the entire group is inferred", async () => {
  const types = await bindings(`
    let rec first = () => { second(); 1 }
    and second = () => { print("x"); 1 };
  `);
  assertEquals(types.first, "Void -> Number!");
  assertEquals(types.second, "Void -> Number!");
});

Deno.test("ordinary tuple positions stay independent while sequence tuple members share taint", () => {
  const scar = taintedType(NumberTy);
  const ordinary = tuple([scar, StringTy]);
  assertEquals(show(ordinary), "(Number!, String)");
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
  assertEquals(types.value, "(Number, String, Bool)!");
  assertEquals(types.clean, "(Number, String, Bool)");
  assertEquals(types.number, "Number!");
  assertEquals(types.text, "String!");
  assertEquals(types.flag, "Bool!");
});

Deno.test("unification joins scars by replacing what a variable holds, without touching a sibling", () => {
  const number = fresh();
  unify(number, NumberTy);
  unify(number, taintedType(NumberTy));
  assertEquals(show(number), "Number!");
  const ordinary = tuple([number, StringTy]);
  assertEquals(show(ordinary), "(Number!, String)");
  assertEquals(show(StringTy), "String");
  assertEquals(show(unify(NumberTy, taintedType(NumberTy))!), "Number!");
  assertEquals(show(NumberTy), "Number");
});

Deno.test("a sequence summary observes late source unification", () => {
  const source = fresh();
  const sequence = sequenceType([source], StringTy);
  const firstView = sequenceView(sequence, source);
  unify(source, taintedType(NumberTy));
  // No extra unification or type-reading traversal is needed to resolve the sequence.
  assertEquals(isTainted(sequence), true);
  assertEquals(show(sequence), "String!");
  assertEquals(show(firstView), "Number!");
  assertEquals(show(StringTy), "String");
});

Deno.test("unifying a sequence alias spreads an incoming scar to all sequence views", () => {
  const source = fresh();
  const sequence = sequenceType([source], NumberTy);
  const firstView = sequenceView(sequence, source);
  const alias = fresh();
  unify(alias, sequence);
  prune(alias);
  unify(alias, taintedType(NumberTy));
  assertEquals(isTainted(firstView), true);
  assertEquals(show(alias), "Number!");
  assertEquals(show(NumberTy), "Number");
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
  assertEquals(types.projected, "Number!");
  assertEquals(types.discarded, "Number!");
  assertEquals(types.ignored, "Void!");
  assertEquals(types.selected, "Number!");
  assertEquals(types.clean, "Number");
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
  assertEquals(types.value, "(((Number!, String), Bool), Number)");
  assertEquals(types.scar, "Number!");
  assertEquals(types.clean, "Number");
});

Deno.test("nested tuple construction summarizes contained scars separately from outer scars", () => {
  const inner = tuple([taintedType(NumberTy), StringTy]);
  const outer = tuple([tuple([inner, StringTy]), StringTy]);
  assertEquals(show(outer), "(((Number!, String), String), String)");
  assertEquals(isTainted(outer), false);
  assertEquals(show(sequenceType([outer], NumberTy)), "Number!");
});

Deno.test("late taint reaches branching container summaries without merging their tuple positions", () => {
  const source = fresh();
  const left = tuple([source, StringTy]);
  const right = tuple([tuple([source, StringTy]), StringTy]);
  const leftResult = sequenceType([left], StringTy);
  const rightResult = sequenceType([right], NumberTy);
  unify(source, taintedType(NumberTy));
  assertEquals(show(left), "(Number!, String)");
  assertEquals(show(right), "((Number!, String), String)");
  assertEquals(show(leftResult), "String!");
  assertEquals(show(rightResult), "Number!");
});

Deno.test("symbolic summaries terminate across alias cycles and a deep chain of joins", () => {
  const source = fresh();
  const alias = fresh();
  unify(source, alias);
  unify(alias, source);
  let result = source;
  for (let i = 0; i < 10000; i++) result = sequenceType([result], { ...NumberTy });
  unify(alias, taintedType(NumberTy));
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
  unify(scar.params[0], taintedType(NumberTy));
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
  unify(source, taintedType(NumberTy));
  assertEquals(show(result), "String!");
  assertEquals(isTainted(record), false);
});

Deno.test("solving an FFI placeholder binds its contained summary", () => {
  const placeholder = freshFfi("get", undefined, ["value"]);
  const result = sequenceType([placeholder], { ...StringTy });
  const source = fresh();
  solveFfi(placeholder, tuple([source, StringTy]));
  unify(source, taintedType(NumberTy));
  assertEquals(show(result), "String!");
  assertEquals(show(placeholder), "(Number!, String)");
});

Deno.test("a sequence view shares its symbolic summary with its consumers", () => {
  const source = fresh();
  const sequence = sequenceType([source], { ...StringTy });
  const view = sequenceView(sequence, StringTy);
  const consumer = sequenceType([view], { ...NumberTy });
  unify(source, taintedType(NumberTy));
  assertEquals(show(view), "String!");
  assertEquals(show(consumer), "Number!");
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
  unify(instance.params[0], taintedType(NumberTy));
  assertEquals(show(discarded), "String!");
});

Deno.test("sequence summaries retain no discarded value shapes", () => {
  const discarded = tuple([
    tuple([NumberTy, StringTy]),
    fn([tuple([StringTy, NumberTy])], tuple([NumberTy, StringTy])),
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
  assertEquals(types.scar, "Void -> Number!");
  assertEquals(types.clean, "Void -> Number");
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
  assertEquals(types.original, "R<Number, 'a>!");
  assertEquals(types.direct, "R<Number, 'a>!");
  assertEquals(types.value, "R<Number, 'a>!");
  assertEquals(types.clean, "R<Number, 'a>");
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
  assertEquals(types.both, "Void -> List<Number!>!");
  assertEquals(types.inner, "Void -> List<Number!>");
  assertEquals(types.outer, "Void -> List<Number>!");
  assertEquals(types.bothValue, "List<Number!>!");
  assertEquals(types.innerValue, "List<Number!>");
  assertEquals(types.outerValue, "List<Number>!");
  assertEquals(types.element, "Number!");
  assertEquals(types.outerElement, "Number!");
});

Deno.test("concrete function types absorb a joined scar through variables and results", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1 };
    let clean: Void -> Number = () => { 1 };
    let held: Void -> Number = eff;
    let heldValue = held();
    type Cb = Void -> Number;
    let run = (f: Cb) => { f(); 1 };
    let aliased = run(eff);
    let pureAliased = run(() => { 1 });
    let choose = (c) => { if (c) { clean } else { eff } };
    let branch = choose(true)();
    let cleanAfter = clean();
    let list = [clean, eff];
    let element = match(list) { [a, b] => { a() }, _ => { 1 } };
    let positions = (c) => { if (c) { (1, "a") } else { (eff(), "b") } };
  `);
  assertEquals(types.heldValue, "Number!");
  assertEquals(types.aliased, "Number!");
  assertEquals(types.pureAliased, "Number");
  assertEquals(types.branch, "Number!");
  assertEquals(types.cleanAfter, "Number");
  assertEquals(types.element, "Number!");
  assertEquals(types.positions, "Bool -> (Number!, String)");
});

Deno.test("a recursive function's callback reaches its result", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1 };
    let rec go = (f, n) => { if (n < 1) { 1 } else { f(); go(f, n - 1) } };
    let scar = go(eff, 3);
    let clean = go(() => { 2 }, 3);
  `);
  assertEquals(types.scar, "Number!");
  assertEquals(types.clean, "Number");
});

Deno.test("a concrete function field marks the value that holds it", async () => {
  const types = await bindings(`
    let eff ==> { print "a"; 1 };
    let pure = () => { 1 };
    type H = | H<Void -> Number>;
    record Holder = { f: Void -> Number, n: Number };
    let scar = H(eff);
    let clean = H(pure);
    let called = match(H(eff)) { H(f) => { f() } };
    let cleanCalled = match(H(pure)) { H(f) => { f() } };
    let wrap = (x) => { H(x) };
    let lateScar = wrap(eff);
    let lateClean = wrap(pure);
    let record = Holder(eff, 1);
    let recordClean = Holder(pure, 1);
    let generic = Some(eff);
  `);
  assertEquals(types.scar, "H!");
  assertEquals(types.clean, "H");
  assertEquals(types.called, "Number!");
  assertEquals(types.cleanCalled, "Number");
  assertEquals(types.lateScar, "H!");
  assertEquals(types.lateClean, "H");
  assertEquals(types.record, "Holder!");
  assertEquals(types.recordClean, "Holder");
  assertEquals(types.generic, "Option<Void -> Number!>");
});
