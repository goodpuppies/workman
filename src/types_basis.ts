import { basisTypes } from "./basis.ts";
import {
  BoolTy,
  type Env,
  fn,
  fresh,
  freshTypeInfo,
  generalize,
  named,
  NumberTy,
  StringTy,
  tuple,
  type Ty,
  type TypeDeclInfo,
  type TypeEnv,
  typeFromAst,
  type TypeInfo,
  VoidTy,
} from "./types.ts";

function callArg(items: Ty[]): Ty {
  if (items.length === 0) return VoidTy;
  if (items.length === 1) return items[0];
  return tuple(items);
}

export function baseEnv(typeEnv: TypeEnv = baseTypeEnv()): Env {
  const env: Env = new Map();
  const binaryNum = fn([tuple([NumberTy, NumberTy])], NumberTy);
  for (const op of ["+", "-", "*", "/", "%"]) env.set(op, { vars: [], type: binaryNum });
  env.set("++", { vars: [], type: fn([tuple([StringTy, StringTy])], StringTy) });
  for (const op of ["<", "<=", ">", ">="]) {
    env.set(op, { vars: [], type: fn([tuple([NumberTy, NumberTy])], BoolTy) });
  }
  for (const op of ["==", "!="]) {
    const a = fresh() as Extract<Ty, { tag: "var" }>;
    env.set(op, { vars: [a.id], type: fn([tuple([a, a])], BoolTy) });
  }
  env.set("&&", { vars: [], type: fn([tuple([BoolTy, BoolTy])], BoolTy) });
  env.set("||", { vars: [], type: fn([tuple([BoolTy, BoolTy])], BoolTy) });
  const printable = fresh() as Extract<Ty, { tag: "var" }>;
  env.set("print", { vars: [printable.id], type: fn([printable], VoidTy) });
  addBasisConstructors(env, typeEnv);
  addBasisValues(env, typeEnv);
  return env;
}

function addResultValues(env: Env, typeEnv: TypeEnv) {
  const result = typeEnv.get("Result");
  if (!result) return;
  const basisFn = (name: string, vars: Extract<Ty, { tag: "var" }>[], type: Ty) => {
    env.set(name, { vars: vars.map((v) => v.id), type, status: "value", basis: true });
  };
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Result.map",
      [a, b, e],
      fn([tuple([named(result, [a, e]), fn([a], b)])], named(result, [b, e])),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Result.andThen",
      [a, b, e],
      fn([tuple([named(result, [a, e]), fn([a], named(result, [b, e]))])], named(result, [b, e])),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    const f = fresh("f") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Result.mapErr",
      [a, e, f],
      fn([tuple([named(result, [a, e]), fn([e], f)])], named(result, [a, f])),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Result.withDefault",
      [a, e],
      fn([tuple([named(result, [a, e]), a])], a),
    );
  }
  for (const arity of [2, 3, 4]) {
    const inputs = Array.from(
      { length: arity },
      (_, i) => fresh(String.fromCharCode(97 + i)) as Extract<Ty, { tag: "var" }>,
    );
    const out = fresh("out") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      `Result.map${arity}`,
      [...inputs, out, e],
      fn(
        [tuple([
          ...inputs.map((input) => named(result, [input, e])),
          fn([tuple(inputs)], out),
        ])],
        named(result, [out, e]),
      ),
    );
  }
  {
    const jsArray = typeEnv.get("Js.Array");
    if (jsArray) {
      const a = fresh("a") as Extract<Ty, { tag: "var" }>;
      const e = fresh("e") as Extract<Ty, { tag: "var" }>;
      basisFn(
        "Result.all",
        [a, e],
        fn([named(jsArray, [named(result, [a, e])])], named(result, [named(jsArray, [a]), e])),
      );
      const input = fresh("input") as Extract<Ty, { tag: "var" }>;
      const output = fresh("output") as Extract<Ty, { tag: "var" }>;
      const err = fresh("err") as Extract<Ty, { tag: "var" }>;
      basisFn(
        "Result.traverse",
        [input, output, err],
        fn(
          [tuple([
            named(jsArray, [input]),
            fn([input], named(result, [output, err])),
          ])],
          named(result, [named(jsArray, [output]), err]),
        ),
      );
    }
  }
}

function addOptionValues(env: Env, typeEnv: TypeEnv) {
  const option = typeEnv.get("Option");
  if (!option) return;
  const basisFn = (name: string, vars: Extract<Ty, { tag: "var" }>[], type: Ty) => {
    env.set(name, { vars: vars.map((v) => v.id), type, status: "value", basis: true });
  };
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Option.map",
      [a, b],
      fn([tuple([named(option, [a]), fn([a], b)])], named(option, [b])),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Option.andThen",
      [a, b],
      fn([tuple([named(option, [a]), fn([a], named(option, [b]))])], named(option, [b])),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Option.withDefault",
      [a],
      fn([tuple([named(option, [a]), a])], a),
    );
  }
}

function addTaskValues(env: Env, typeEnv: TypeEnv) {
  const result = typeEnv.get("Result");
  const taskInfo = typeEnv.get("Task");
  const jsArray = typeEnv.get("Js.Array");
  if (!result || !taskInfo) return;
  const task = (value: Ty, error: Ty) => named(taskInfo, [value, error]);
  const basisFn = (name: string, vars: Extract<Ty, { tag: "var" }>[], type: Ty) => {
    env.set(name, { vars: vars.map((v) => v.id), type, status: "value", basis: true });
  };
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.fromResult", [a, e], fn([named(result, [a, e])], task(a, e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.succeed", [a, e], fn([a], task(a, e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.fail", [a, e], fn([e], task(a, e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.map", [a, b, e], fn([tuple([task(a, e), fn([a], b)])], task(b, e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.andThen", [a, b, e], fn([tuple([task(a, e), fn([a], task(b, e))])], task(b, e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    const f = fresh("f") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.mapErr", [a, e, f], fn([tuple([task(a, e), fn([e], f)])], task(a, f)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.recover", [a, e], fn([tuple([task(a, e), fn([e], a)])], task(a, e)));
  }
  if (jsArray) {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.all", [a, e], fn([named(jsArray, [task(a, e)])], task(named(jsArray, [a]), e)));
    const input = fresh("input") as Extract<Ty, { tag: "var" }>;
    const output = fresh("output") as Extract<Ty, { tag: "var" }>;
    const err = fresh("err") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Task.traverse",
      [input, output, err],
      fn(
        [tuple([
          named(jsArray, [input]),
          fn([input], task(output, err)),
        ])],
        task(named(jsArray, [output]), err),
      ),
    );
  }
}

let basisTypeEnvCache: Map<string, TypeInfo> | undefined;

export function baseTypeEnv(): TypeEnv {
  if (!basisTypeEnvCache) {
    basisTypeEnvCache = new Map(
      ["Number", "Bool", "String", "Void", "Js.Value", "Js.Object", "Js.Error"].map((name) => [
        name,
        { ...freshTypeInfo(name, 0), basis: true },
      ]),
    );
    basisTypeEnvCache.set("Js.Array", {
      ...freshTypeInfo("Js.Array", 1),
      basis: true,
      argLabels: ["element"],
    });
    basisTypeEnvCache.set("Js.Dict", {
      ...freshTypeInfo("Js.Dict", 1),
      basis: true,
      argLabels: ["value"],
    });
    for (const type of basisTypes) {
      basisTypeEnvCache.set(type.name, {
        ...freshTypeInfo(type.name, type.params.length),
        basis: true,
        basisConstructors: type.ctors.map((ctor) => ctor.name),
        argLabels: type.params.map((param) =>
          param === "e" || param === "err" ? "error" : param === "a" ? "value" : param
        ),
      });
    }
    basisTypeEnvCache.set("Task", {
      ...freshTypeInfo("Task", 2),
      basis: true,
      argLabels: ["value", "error"],
    });
  }
  return new Map(basisTypeEnvCache);
}

export function baseAdts(typeEnv: TypeEnv): Map<number, TypeDeclInfo> {
  const adts = new Map<number, TypeDeclInfo>();
  for (const type of basisTypes) {
    const info = typeEnv.get(type.name);
    if (!info) continue;
    adts.set(info.id, {
      type: info,
      name: type.name,
      params: type.params,
      ctors: type.ctors.map((ctor) => ({ name: ctor.name, args: ctor.args })),
    });
  }
  return adts;
}

function addBasisConstructors(env: Env, typeEnv: TypeEnv) {
  for (const type of basisTypes) {
    const info = typeEnv.get(type.name);
    if (!info) continue;
    const vars = new Map(type.params.map((name) => [name, fresh(name)] as const));
    const result = named(info, type.params.map((name) => vars.get(name)!));
    for (const ctor of type.ctors) {
      const args = ctor.args.map((arg) =>
        typeFromAst(arg, typeEnv, vars, { allowFreeVars: false })
      );
      const ctorType = args.length === 0 ? result : fn([callArg(args)], result);
      env.set(ctor.name, {
        ...generalize(new Map(), ctorType),
        status: "constructor",
        basis: true,
      });
    }
  }
}

function addBasisValues(env: Env, typeEnv: TypeEnv) {
  const result = typeEnv.get("Result");
  const jsError = typeEnv.get("Js.Error");
  if (!result || !jsError) return;
  const input = fresh("input") as Extract<Ty, { tag: "var" }>;
  const output = fresh("output") as Extract<Ty, { tag: "var" }>;
  env.set("Json.assert", {
    vars: [input.id, output.id],
    type: fn([input], named(result, [output, named(jsError)])),
    status: "value",
    basis: true,
  });
  addResultValues(env, typeEnv);
  addOptionValues(env, typeEnv);
  addTaskValues(env, typeEnv);
  const option = typeEnv.get("Option");
  const jsDict = typeEnv.get("Js.Dict");
  if (option && jsDict) {
    const emptyValue = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Dict.empty", {
      vars: [emptyValue.id],
      type: fn([VoidTy], named(jsDict, [emptyValue])),
      status: "value",
      basis: true,
    });
    const getValue = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Dict.get", {
      vars: [getValue.id],
      type: fn([tuple([named(jsDict, [getValue]), StringTy])], named(option, [getValue])),
      status: "value",
      basis: true,
    });
    const setValue = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Dict.set", {
      vars: [setValue.id],
      type: fn([tuple([named(jsDict, [setValue]), StringTy, setValue])], VoidTy),
      status: "value",
      basis: true,
    });
  }
}
