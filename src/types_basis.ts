import { basisTypes } from "./basis.ts";
import { BASIS_OPERATORS, BASIS_TYPES } from "./basis_manifest.ts";
import { type CompilerSemanticId, GPU_SEMANTIC_IDS } from "./compiler_semantics.ts";
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
  typeInfoByName,
  VoidTy,
} from "./types.ts";

function callArg(items: Ty[]): Ty {
  if (items.length === 0) return VoidTy;
  if (items.length === 1) return items[0];
  return tuple(items);
}

export type BasisOptions = { includeAlgebraicBasis?: boolean };

export type PervasiveBinding = Readonly<{
  source: string;
  target: string;
  profiles: readonly ("kernel" | "default")[];
}>;

export const PERVASIVE_BINDINGS: readonly PervasiveBinding[] = Object.freeze([
  Object.freeze({
    source: "print",
    target: "print",
    profiles: Object.freeze(["kernel", "default"] as const),
  }),
  ...[
    ["Option.None", "None"],
    ["Option.Some", "Some"],
    ["Result.Ok", "Ok"],
    ["Result.Err", "Err"],
    ["List.Nil", "Nil"],
    ["List.Cons", "Cons"],
  ].map(([source, target]) =>
    Object.freeze({
      source,
      target,
      profiles: Object.freeze(["default"] as const),
    })
  ),
]);

export function baseEnv(
  typeEnv: TypeEnv = baseTypeEnv(),
  options: BasisOptions = {},
): Env {
  const env: Env = new Map();
  const pervasiveSources: Env = new Map();
  const printable = fresh() as Extract<Ty, { tag: "var" }>;
  pervasiveSources.set("print", {
    vars: [printable.id],
    type: fn([printable], VoidTy),
    standardLibrary: true,
  });
  const textValue = fresh() as Extract<Ty, { tag: "var" }>;
  env.set("Text.of", {
    vars: [textValue.id],
    type: fn([textValue], StringTy),
    status: "value",
    basis: true,
  });
  if (options.includeAlgebraicBasis !== false) {
    const debugError = fresh() as Extract<Ty, { tag: "var" }>;
    env.set("Debug.errorMessage", {
      vars: [debugError.id],
      type: fn([debugError], StringTy),
      status: "value",
      basis: true,
    });
  }
  if (options.includeAlgebraicBasis !== false) {
    addBasisConstructors(env, pervasiveSources, typeEnv);
    addBasisValues(env, typeEnv);
    addGpuBasisValues(env, typeEnv);
  }
  installPervasiveBindings(
    env,
    pervasiveSources,
    options.includeAlgebraicBasis === false ? "kernel" : "default",
  );
  return env;
}

/** Fixed expression operators belong to the language kernel, not the ordinary value namespace. */
export function basisOperatorEnv(): Env {
  const env: Env = new Map();
  const operator = (vars: number[], type: Ty) => ({ vars, type, standardLibrary: true });
  for (const descriptor of BASIS_OPERATORS) {
    switch (descriptor.kind) {
      case "number":
        env.set(
          descriptor.spelling,
          operator([], fn([tuple([NumberTy, NumberTy])], NumberTy)),
        );
        break;
      case "string":
        env.set(
          descriptor.spelling,
          operator([], fn([tuple([StringTy, StringTy])], StringTy)),
        );
        break;
      case "number-order":
        env.set(
          descriptor.spelling,
          operator([], fn([tuple([NumberTy, NumberTy])], BoolTy)),
        );
        break;
      case "equality": {
        const a = fresh() as Extract<Ty, { tag: "var" }>;
        env.set(
          descriptor.spelling,
          operator([a.id], fn([tuple([a, a])], BoolTy)),
        );
        break;
      }
      case "boolean":
        env.set(
          descriptor.spelling,
          operator([], fn([tuple([BoolTy, BoolTy])], BoolTy)),
        );
        break;
    }
  }
  return env;
}

function addGpuBasisValues(env: Env, typeEnv: TypeEnv) {
  const colorInfo = typeInfoByName(typeEnv, "Gpu.Color");
  const fragmentInfo = typeInfoByName(typeEnv, "Gpu.Fragment");
  const uniformInfo = typeInfoByName(typeEnv, "Gpu.Uniform");
  const textureInfo = typeInfoByName(typeEnv, "Gpu.Texture2D");
  const sampledTextureInfo = typeInfoByName(typeEnv, "Gpu.SampledTexture2D");
  const renderTargetInfo = typeInfoByName(typeEnv, "Gpu.RenderTarget2D");
  const samplerInfo = typeInfoByName(typeEnv, "Gpu.Sampler");
  const shaderTargetInfo = typeInfoByName(typeEnv, "Gpu.ShaderTarget");
  const jsArrayInfo = typeInfoByName(typeEnv, "Js.Array");
  const jsObjectInfo = typeInfoByName(typeEnv, "Js.Object");
  const jsErrorInfo = typeInfoByName(typeEnv, "Js.Error");
  const resultInfo = typeInfoByName(typeEnv, "Result");
  const optionInfo = typeInfoByName(typeEnv, "Option");
  if (
    !colorInfo || !fragmentInfo || !uniformInfo || !textureInfo || !sampledTextureInfo ||
    !renderTargetInfo || !samplerInfo || !shaderTargetInfo || !jsArrayInfo || !jsObjectInfo ||
    !jsErrorInfo || !resultInfo || !optionInfo
  ) {
    throw new Error("missing compiler-owned Gpu basis types");
  }

  const rgba = tuple([NumberTy, NumberTy, NumberTy, NumberTy]);
  const fragment = named(fragmentInfo);
  const texture = named(textureInfo);
  const sampledTexture = named(sampledTextureInfo);
  const renderTarget = named(renderTargetInfo);
  const sampler = named(samplerInfo);
  const jsError = named(jsErrorInfo);
  const jsObject = named(jsObjectInfo);
  const result = (value: Ty) => named(resultInfo, [value, jsError]);
  const basisFn = (
    name: string,
    semanticId: CompilerSemanticId,
    vars: Extract<Ty, { tag: "var" }>[],
    type: Ty,
  ) => {
    env.set(name, {
      vars: vars.map((item) => item.id),
      type,
      status: "value",
      basis: true,
      semanticId,
    });
  };

  basisFn(
    "Gpu.color",
    GPU_SEMANTIC_IDS.color,
    [],
    fn([rgba], rgba),
  );
  basisFn(
    "Gpu.fragment",
    GPU_SEMANTIC_IDS.fragment,
    [],
    fn([fn([tuple([NumberTy, NumberTy])], rgba)], fragment),
  );
  basisFn("Gpu.i32", GPU_SEMANTIC_IDS.i32, [], fn([NumberTy], NumberTy));
  basisFn("Gpu.f32", GPU_SEMANTIC_IDS.f32, [], fn([NumberTy], NumberTy));

  {
    const value = fresh("gpuUniformValue") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Gpu.uniform",
      GPU_SEMANTIC_IDS.uniform,
      [value],
      fn([value], named(uniformInfo, [value])),
    );
  }
  {
    const value = fresh("gpuUniformValue") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Gpu.read",
      GPU_SEMANTIC_IDS.read,
      [value],
      fn([named(uniformInfo, [value])], value),
    );
  }
  {
    const value = fresh("gpuUniformValue") as Extract<Ty, { tag: "var" }>;
    const uniform = named(uniformInfo, [value]);
    basisFn(
      "Gpu.withValue",
      GPU_SEMANTIC_IDS.withValue,
      [value],
      fn([tuple([uniform, value])], uniform),
    );
  }
  basisFn("Gpu.slang", GPU_SEMANTIC_IDS.slang, [], fn([fragment], StringTy));
  basisFn("Gpu.glsl", GPU_SEMANTIC_IDS.glsl, [], fn([fragment], StringTy));
  basisFn(
    "Gpu.callableName",
    GPU_SEMANTIC_IDS.callableName,
    [],
    fn([fragment], StringTy),
  );
  basisFn("Gpu.wgsl", GPU_SEMANTIC_IDS.wgsl, [], fn([fragment], StringTy));
  basisFn(
    "Gpu.shaderSource",
    GPU_SEMANTIC_IDS.shaderSource,
    [],
    fn([tuple([fragment, named(shaderTargetInfo)])], StringTy),
  );
  basisFn(
    "Gpu.vertexEntryPoint",
    GPU_SEMANTIC_IDS.vertexEntryPoint,
    [],
    fn([fragment], StringTy),
  );
  basisFn(
    "Gpu.fragmentEntryPoint",
    GPU_SEMANTIC_IDS.fragmentEntryPoint,
    [],
    fn([fragment], StringTy),
  );
  basisFn(
    "Gpu.artifactIdentity",
    GPU_SEMANTIC_IDS.artifactIdentity,
    [],
    fn([fragment], StringTy),
  );
  addGpuUniformAccessor(
    env,
    fragmentInfo,
    "Gpu.uniformBinding",
    GPU_SEMANTIC_IDS.uniformBinding,
    NumberTy,
  );
  addGpuUniformAccessor(
    env,
    fragmentInfo,
    "Gpu.uniformByteLength",
    GPU_SEMANTIC_IDS.uniformByteLength,
    NumberTy,
  );
  addGpuUniformAccessor(
    env,
    fragmentInfo,
    "Gpu.uniformBytes",
    GPU_SEMANTIC_IDS.uniformBytes,
    named(jsArrayInfo, [NumberTy]),
  );

  {
    const device = fresh("gpuDevice") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Gpu.texture2D",
      GPU_SEMANTIC_IDS.texture2D,
      [device],
      fn([tuple([device, NumberTy, NumberTy])], result(texture)),
    );
  }
  basisFn(
    "Gpu.sampledTexture2D",
    GPU_SEMANTIC_IDS.sampledTexture2D,
    [],
    fn([texture], result(sampledTexture)),
  );
  basisFn(
    "Gpu.renderTarget2D",
    GPU_SEMANTIC_IDS.renderTarget2D,
    [],
    fn([texture], result(renderTarget)),
  );
  for (
    const [name, semanticId] of [
      ["Gpu.nearestSampler", GPU_SEMANTIC_IDS.nearestSampler],
      ["Gpu.linearSampler", GPU_SEMANTIC_IDS.linearSampler],
    ] as const
  ) {
    const device = fresh("gpuDevice") as Extract<Ty, { tag: "var" }>;
    basisFn(name, semanticId, [device], fn([device], result(sampler)));
  }
  basisFn(
    "Gpu.destroyTexture2D",
    GPU_SEMANTIC_IDS.destroyTexture2D,
    [],
    fn([texture], result(VoidTy)),
  );
  {
    const device = fresh("gpuDevice") as Extract<Ty, { tag: "var" }>;
    const buffer = fresh("gpuUniformBuffer") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Gpu.bindGroupEntries",
      GPU_SEMANTIC_IDS.bindGroupEntries,
      [device, buffer],
      fn(
        [tuple([fragment, device, named(optionInfo, [buffer])])],
        result(named(jsArrayInfo, [jsObject])),
      ),
    );
  }
  addGpuUniformAccessor(
    env,
    fragmentInfo,
    "Gpu.bindingCount",
    GPU_SEMANTIC_IDS.bindingCount,
    NumberTy,
  );
  basisFn(
    "Gpu.renderTargetView",
    GPU_SEMANTIC_IDS.renderTargetView,
    [],
    fn([renderTarget], result(jsObject)),
  );
  {
    const device = fresh("gpuDevice") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Gpu.validateRenderTarget",
      GPU_SEMANTIC_IDS.validateRenderTarget,
      [device],
      fn([tuple([fragment, renderTarget, device])], result(VoidTy)),
    );
  }
}

function addGpuUniformAccessor(
  env: Env,
  fragmentInfo: TypeInfo,
  name: string,
  semanticId: CompilerSemanticId,
  result: Ty,
) {
  env.set(name, {
    vars: [],
    type: fn([named(fragmentInfo)], result),
    status: "value",
    basis: true,
    semanticId,
  });
}

function addTaskValues(env: Env, typeEnv: TypeEnv) {
  const result = typeInfoByName(typeEnv, "Result");
  const taskInfo = typeInfoByName(typeEnv, "Task");
  const jsArray = typeInfoByName(typeEnv, "Js.Array");
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
    const c = fresh("c") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Task.map2",
      [a, b, c, e],
      fn([tuple([task(a, e), task(b, e), fn([tuple([a, b])], c)])], task(c, e)),
    );
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Task.race",
      [a, e],
      fn([tuple([task(a, e), task(a, e)])], task(a, e)),
    );
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
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    const f = fresh("f") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Task.orElse",
      [a, e, f],
      fn([tuple([task(a, e), fn([e], task(a, f))])], task(a, f)),
    );
  }
  if (jsArray) {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    basisFn("Task.all", [a, e], fn([named(jsArray, [task(a, e)])], task(named(jsArray, [a]), e)));
  }
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    const complete = fn([named(result, [a, e])], VoidTy);
    const register = fn([complete], named(result, [VoidTy, e]));
    basisFn("Task.new", [a, e], fn([register], task(a, e)));
  }
}

let basisTypeEnvCache: Map<string, TypeInfo> | undefined;

export function baseTypeEnv(options: BasisOptions = {}): TypeEnv {
  if (!basisTypeEnvCache) {
    basisTypeEnvCache = new Map(
      [...BASIS_TYPES].sort((left, right) => {
        const leftKernel = left.profiles.some((profile) => profile === "kernel");
        const rightKernel = right.profiles.some((profile) => profile === "kernel");
        return Number(rightKernel) - Number(leftKernel);
      }).map((descriptor) => [
        descriptor.name,
        {
          ...freshTypeInfo(descriptor.name, descriptor.arity),
          basis: true,
          basisConstructors: descriptor.constructors?.map((ctor) => ctor.name),
          argLabels: descriptor.argLabels ? [...descriptor.argLabels] : undefined,
        },
      ]),
    );
  }
  const result = new Map(basisTypeEnvCache);
  const profile = options.includeAlgebraicBasis === false ? "kernel" : "default";
  for (const descriptor of BASIS_TYPES) {
    if (!descriptor.profiles.some((candidate) => candidate === profile)) {
      result.delete(descriptor.name);
    }
  }
  return result;
}

export function baseAdts(typeEnv: TypeEnv): Map<number, TypeDeclInfo> {
  const adts = new Map<number, TypeDeclInfo>();
  for (const type of basisTypes) {
    const info = typeInfoByName(typeEnv, type.name);
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

function addBasisConstructors(env: Env, pervasiveSources: Env, typeEnv: TypeEnv) {
  for (const type of basisTypes) {
    const info = typeInfoByName(typeEnv, type.name);
    if (!info) continue;
    const vars = new Map(type.params.map((name) => [name, fresh(name)] as const));
    const result = named(info, type.params.map((name) => vars.get(name)!));
    for (const ctor of type.ctors) {
      const args = ctor.args.map((arg) =>
        typeFromAst(arg, typeEnv, vars, { allowFreeVars: false })
      );
      const ctorType = args.length === 0 ? result : fn([callArg(args)], result);
      const scheme = {
        ...generalize(new Map(), ctorType),
        status: "constructor" as const,
        basis: true,
      };
      if (ctor.name.includes(".")) {
        env.set(ctor.name, scheme);
      } else {
        const qualified = `${type.name}.${ctor.name}`;
        env.set(qualified, scheme);
        pervasiveSources.set(qualified, scheme);
      }
    }
  }
}

function installPervasiveBindings(
  target: Env,
  sources: ReadonlyMap<string, import("./types.ts").Scheme>,
  profile: "kernel" | "default",
): void {
  for (const binding of PERVASIVE_BINDINGS) {
    if (!binding.profiles.includes(profile)) continue;
    const scheme = sources.get(binding.source);
    if (!scheme) throw new Error(`missing pervasive basis source ${binding.source}`);
    target.set(binding.target, scheme);
  }
}

function addBasisValues(env: Env, typeEnv: TypeEnv) {
  const result = typeInfoByName(typeEnv, "Result");
  const jsError = typeInfoByName(typeEnv, "Js.Error");
  if (!result || !jsError) return;
  const input = fresh("input") as Extract<Ty, { tag: "var" }>;
  const output = fresh("output") as Extract<Ty, { tag: "var" }>;
  env.set("Json.assert", {
    vars: [input.id, output.id],
    type: fn([input], named(result, [output, named(jsError)])),
    status: "value",
    basis: true,
  });
  addTaskValues(env, typeEnv);
  addJsArrayValues(env, typeEnv);
  addWordValues(env, typeEnv);
  addWord8VectorValues(env, typeEnv);
  addWord8VectorSliceValues(env, typeEnv);
  addBytesValues(env, typeEnv);
  addPackWordValues(env, typeEnv);
  addFloatValues(env, typeEnv);
  addPackRealValues(env, typeEnv);
  addByteValues(env, typeEnv);
  const option = typeInfoByName(typeEnv, "Option");
  const jsDict = typeInfoByName(typeEnv, "Js.Dict");
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
  const jsTable = typeInfoByName(typeEnv, "Js.Table");
  if (option && jsTable) {
    const tableEmpty = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Table.empty", {
      vars: [tableEmpty.id],
      type: fn([VoidTy], named(jsTable, [tableEmpty])),
      status: "value",
      basis: true,
    });
    const tableGet = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Table.get", {
      vars: [tableGet.id],
      type: fn([tuple([named(jsTable, [tableGet]), StringTy])], named(option, [tableGet])),
      status: "value",
      basis: true,
    });
    const tableSet = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Table.set", {
      vars: [tableSet.id],
      type: fn([tuple([named(jsTable, [tableSet]), StringTy, tableSet])], VoidTy),
      status: "value",
      basis: true,
    });
    // Number-keyed accessors: integer keys hash far cheaper than freshly built
    // strings, which never have a cached hash.
    const tableGetAt = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Table.getAt", {
      vars: [tableGetAt.id],
      type: fn([tuple([named(jsTable, [tableGetAt]), NumberTy])], named(option, [tableGetAt])),
      status: "value",
      basis: true,
    });
    const tableSetAt = fresh("value") as Extract<Ty, { tag: "var" }>;
    env.set("Table.setAt", {
      vars: [tableSetAt.id],
      type: fn([tuple([named(jsTable, [tableSetAt]), NumberTy, tableSetAt])], VoidTy),
      status: "value",
      basis: true,
    });
  }
}

function addWordValues(env: Env, typeEnv: TypeEnv) {
  for (const structure of ["Word8", "Word16", "Word32", "Word64"]) {
    const info = typeInfoByName(typeEnv, `${structure}.word`);
    if (!info) throw new Error(`missing compiler-owned ${structure}.word basis type`);
    const word = named(info);
    const basisValue = (name: string, type: Ty) => {
      env.set(`${structure}.${name}`, {
        vars: [],
        type,
        status: "value",
        basis: true,
      });
    };
    basisValue("wordSize", NumberTy);
    basisValue("fromNumber", fn([NumberTy], word));
    basisValue("toNumber", fn([word], NumberTy));
    for (const name of ["andb", "orb", "xorb", "add", "sub", "mul", "div", "mod"]) {
      basisValue(name, fn([tuple([word, word])], word));
    }
    basisValue("notb", fn([word], word));
    for (const name of ["shiftLeft", "shiftRight", "shiftRightArithmetic"]) {
      basisValue(name, fn([tuple([word, NumberTy])], word));
    }
  }
}

function addWord8VectorValues(env: Env, typeEnv: TypeEnv) {
  const wordInfo = typeInfoByName(typeEnv, "Word8.word");
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  const listInfo = typeInfoByName(typeEnv, "List");
  const optionInfo = typeInfoByName(typeEnv, "Option");
  if (!wordInfo || !vectorInfo || !listInfo || !optionInfo) {
    throw new Error("missing compiler-owned Word8Vector basis types");
  }
  const word = named(wordInfo);
  const vector = named(vectorInfo);
  const list = (item: Ty) => named(listInfo, [item]);
  const option = (item: Ty) => named(optionInfo, [item]);
  const basisValue = (
    name: string,
    vars: Extract<Ty, { tag: "var" }>[],
    type: Ty,
  ) => {
    env.set(`Word8Vector.${name}`, {
      vars: vars.map((item) => item.id),
      type,
      status: "value",
      basis: true,
    });
  };

  basisValue("empty", [], vector);
  basisValue("fromList", [], fn([list(word)], vector));
  basisValue("length", [], fn([vector], NumberTy));
  basisValue("sub", [], fn([tuple([vector, NumberTy])], word));
  basisValue("get", [], fn([tuple([vector, NumberTy])], option(word)));
  basisValue("update", [], fn([tuple([vector, NumberTy, word])], vector));
  basisValue("concat", [], fn([list(vector)], vector));
  basisValue("tabulate", [], fn([tuple([NumberTy, fn([NumberTy], word)])], vector));
  basisValue(
    "mapi",
    [],
    fn([tuple([vector, fn([tuple([NumberTy, word])], word)])], vector),
  );
  {
    const state = fresh("state") as Extract<Ty, { tag: "var" }>;
    basisValue(
      "unfoldN",
      [state],
      fn(
        [tuple([NumberTy, state, fn([state], tuple([word, state]))])],
        tuple([vector, state]),
      ),
    );
  }
  basisValue("toList", [], fn([vector], list(word)));
}

function addWord8VectorSliceValues(env: Env, typeEnv: TypeEnv) {
  const wordInfo = typeInfoByName(typeEnv, "Word8.word");
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  const sliceInfo = typeInfoByName(typeEnv, "Word8VectorSlice.slice");
  const listInfo = typeInfoByName(typeEnv, "List");
  const optionInfo = typeInfoByName(typeEnv, "Option");
  if (!wordInfo || !vectorInfo || !sliceInfo || !listInfo || !optionInfo) {
    throw new Error("missing compiler-owned Word8VectorSlice basis types");
  }
  const word = named(wordInfo);
  const vector = named(vectorInfo);
  const slice = named(sliceInfo);
  const list = (item: Ty) => named(listInfo, [item]);
  const option = (item: Ty) => named(optionInfo, [item]);
  const basisValue = (name: string, type: Ty) => {
    env.set(`Word8VectorSlice.${name}`, {
      vars: [],
      type,
      status: "value",
      basis: true,
    });
  };

  basisValue("full", fn([vector], slice));
  basisValue("slice", fn([tuple([vector, NumberTy, option(NumberTy)])], slice));
  basisValue("subslice", fn([tuple([slice, NumberTy, option(NumberTy)])], slice));
  basisValue("base", fn([slice], tuple([vector, NumberTy, NumberTy])));
  basisValue("length", fn([slice], NumberTy));
  basisValue("isEmpty", fn([slice], BoolTy));
  basisValue("sub", fn([tuple([slice, NumberTy])], word));
  basisValue("get", fn([tuple([slice, NumberTy])], option(word)));
  basisValue("vector", fn([slice], vector));
  basisValue("concat", fn([list(slice)], vector));
}

function addBytesValues(env: Env, typeEnv: TypeEnv) {
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  const taskInfo = typeInfoByName(typeEnv, "Task");
  const jsErrorInfo = typeInfoByName(typeEnv, "Js.Error");
  if (!vectorInfo || !taskInfo || !jsErrorInfo) {
    throw new Error("missing compiler-owned Bytes basis types");
  }
  const vector = named(vectorInfo);
  const error = named(jsErrorInfo);
  const task = (value: Ty) => named(taskInfo, [value, error]);
  const basisValue = (name: string, type: Ty) => {
    env.set(`Bytes.${name}`, {
      vars: [],
      type,
      status: "value",
      basis: true,
    });
  };

  basisValue("readFile", fn([StringTy], task(vector)));
  basisValue("readSlice", fn([tuple([StringTy, NumberTy, NumberTy])], task(vector)));
  basisValue("writeFile", fn([tuple([StringTy, vector])], task(VoidTy)));
}

function addPackWordValues(env: Env, typeEnv: TypeEnv) {
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  const sliceInfo = typeInfoByName(typeEnv, "Word8VectorSlice.slice");
  if (!vectorInfo || !sliceInfo) throw new Error("missing compiler-owned PackWord byte types");
  const vector = named(vectorInfo);
  const slice = named(sliceInfo);
  for (const width of [16, 32, 64]) {
    const wordInfo = typeInfoByName(typeEnv, `Word${width}.word`);
    if (!wordInfo) throw new Error(`missing compiler-owned Word${width}.word basis type`);
    const word = named(wordInfo);
    for (const endian of ["Little", "Big"]) {
      const structure = `PackWord${width}${endian}`;
      const basisValue = (name: string, type: Ty) => {
        env.set(`${structure}.${name}`, {
          vars: [],
          type,
          status: "value",
          basis: true,
        });
      };
      basisValue("bytesPerElem", NumberTy);
      basisValue("isBigEndian", BoolTy);
      basisValue("subVec", fn([tuple([vector, NumberTy])], word));
      basisValue("subSlice", fn([tuple([slice, NumberTy])], word));
      basisValue("pack", fn([word], vector));
    }
  }
}

function addFloatValues(env: Env, typeEnv: TypeEnv) {
  for (const structure of ["Float32", "Float64"]) {
    const info = typeInfoByName(typeEnv, `${structure}.real`);
    if (!info) throw new Error(`missing compiler-owned ${structure}.real basis type`);
    const real = named(info);
    const basisValue = (name: string, type: Ty) => {
      env.set(`${structure}.${name}`, {
        vars: [],
        type,
        status: "value",
        basis: true,
      });
    };
    basisValue("fromNumber", fn([NumberTy], real));
    basisValue("toNumber", fn([real], NumberTy));
    for (const name of ["add", "sub", "mul", "div"]) {
      basisValue(name, fn([tuple([real, real])], real));
    }
    basisValue("neg", fn([real], real));
  }
}

function addPackRealValues(env: Env, typeEnv: TypeEnv) {
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  const sliceInfo = typeInfoByName(typeEnv, "Word8VectorSlice.slice");
  if (!vectorInfo || !sliceInfo) throw new Error("missing compiler-owned PackReal byte types");
  const vector = named(vectorInfo);
  const slice = named(sliceInfo);
  for (const width of [32, 64]) {
    const realInfo = typeInfoByName(typeEnv, `Float${width}.real`);
    if (!realInfo) throw new Error(`missing compiler-owned Float${width}.real basis type`);
    const real = named(realInfo);
    for (const endian of ["Little", "Big"]) {
      const structure = `PackReal${width}${endian}`;
      const basisValue = (name: string, type: Ty) => {
        env.set(`${structure}.${name}`, {
          vars: [],
          type,
          status: "value",
          basis: true,
        });
      };
      basisValue("bytesPerElem", NumberTy);
      basisValue("isBigEndian", BoolTy);
      basisValue("subVec", fn([tuple([vector, NumberTy])], real));
      basisValue("subSlice", fn([tuple([slice, NumberTy])], real));
      basisValue("pack", fn([real], vector));
    }
  }
}

function addByteValues(env: Env, typeEnv: TypeEnv) {
  const vectorInfo = typeInfoByName(typeEnv, "Word8Vector.vector");
  if (!vectorInfo) throw new Error("missing compiler-owned Byte basis types");
  const vector = named(vectorInfo);
  for (
    const [name, type] of [
      ["bytesToString", fn([vector], StringTy)],
      ["stringToBytes", fn([StringTy], vector)],
    ] as const
  ) {
    env.set(`Byte.${name}`, {
      vars: [],
      type,
      status: "value",
      basis: true,
    });
  }
}

function addJsArrayValues(env: Env, typeEnv: TypeEnv) {
  const jsArray = typeInfoByName(typeEnv, "Js.Array");
  const listInfo = typeInfoByName(typeEnv, "List");
  if (!jsArray || !listInfo) return;
  const basisFn = (name: string, vars: Extract<Ty, { tag: "var" }>[], type: Ty) => {
    env.set(name, { vars: vars.map((v) => v.id), type, status: "value", basis: true });
  };
  const a = fresh("a") as Extract<Ty, { tag: "var" }>;
  basisFn("Js.Array.toList", [a], fn([named(jsArray, [a])], named(listInfo, [a])));
  const b = fresh("b") as Extract<Ty, { tag: "var" }>;
  basisFn("Js.Array.fromList", [b], fn([named(listInfo, [b])], named(jsArray, [b])));
}
