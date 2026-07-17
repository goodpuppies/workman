import { basisTypes } from "./basis.ts";
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
  structural,
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

export type BasisOptions = { includeAlgebraicBasis?: boolean };

export function baseEnv(
  typeEnv: TypeEnv = baseTypeEnv(),
  options: BasisOptions = {},
): Env {
  const env: Env = new Map();
  const standard = (vars: number[], type: Ty) => ({ vars, type, standardLibrary: true });
  const binaryNum = fn([tuple([NumberTy, NumberTy])], NumberTy);
  for (const op of ["+", "-", "*", "/", "%"]) env.set(op, standard([], binaryNum));
  env.set("++", standard([], fn([tuple([StringTy, StringTy])], StringTy)));
  for (const op of ["<", "<=", ">", ">="]) {
    env.set(op, standard([], fn([tuple([NumberTy, NumberTy])], BoolTy)));
  }
  for (const op of ["==", "!="]) {
    const a = fresh() as Extract<Ty, { tag: "var" }>;
    env.set(op, standard([a.id], fn([tuple([a, a])], BoolTy)));
  }
  env.set("&&", standard([], fn([tuple([BoolTy, BoolTy])], BoolTy)));
  env.set("||", standard([], fn([tuple([BoolTy, BoolTy])], BoolTy)));
  const printable = fresh() as Extract<Ty, { tag: "var" }>;
  env.set("print", standard([printable.id], fn([printable], VoidTy)));
  if (options.includeAlgebraicBasis !== false) {
    addBasisConstructors(env, typeEnv);
    addBasisValues(env, typeEnv);
  }
  addGpuBasisValues(env, typeEnv);
  return env;
}

function addGpuBasisValues(env: Env, typeEnv: TypeEnv) {
  const colorInfo = typeEnv.get("Gpu.Color");
  const fragmentInfo = typeEnv.get("Gpu.Fragment");
  const uniformInfo = typeEnv.get("Gpu.Uniform");
  const textureInfo = typeEnv.get("Gpu.Texture2D");
  const sampledTextureInfo = typeEnv.get("Gpu.SampledTexture2D");
  const renderTargetInfo = typeEnv.get("Gpu.RenderTarget2D");
  const samplerInfo = typeEnv.get("Gpu.Sampler");
  const jsArrayInfo = typeEnv.get("Js.Array");
  const jsObjectInfo = typeEnv.get("Js.Object");
  const jsErrorInfo = typeEnv.get("Js.Error");
  const resultInfo = typeEnv.get("Result");
  const optionInfo = typeEnv.get("Option");
  if (
    !colorInfo || !fragmentInfo || !uniformInfo || !textureInfo || !sampledTextureInfo ||
    !renderTargetInfo || !samplerInfo || !jsArrayInfo || !jsObjectInfo || !jsErrorInfo ||
    !resultInfo || !optionInfo
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

  basisFn("Gpu.wgsl", GPU_SEMANTIC_IDS.wgsl, [], fn([fragment], StringTy));
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
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    env.set("Task", {
      vars: [a.id, b.id, e.id],
      type: structural([
        { name: "fn", type: fn([fn([a], task(b, e))], fn([task(a, e)], task(b, e))) },
      ]),
      status: "value",
      basis: true,
    });
  }
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
  }
  const listInfo = typeEnv.get("List");
  if (listInfo) {
    {
      const a = fresh("a") as Extract<Ty, { tag: "var" }>;
      const e = fresh("e") as Extract<Ty, { tag: "var" }>;
      basisFn(
        "Task.collectList",
        [a, e],
        fn([named(listInfo, [task(a, e)])], task(named(listInfo, [a]), e)),
      );
    }
    const input = fresh("input") as Extract<Ty, { tag: "var" }>;
    const output = fresh("output") as Extract<Ty, { tag: "var" }>;
    const err = fresh("err") as Extract<Ty, { tag: "var" }>;
    basisFn(
      "Task.traverse",
      [input, output, err],
      fn(
        [tuple([
          named(listInfo, [input]),
          fn([input], task(output, err)),
        ])],
        task(named(listInfo, [output]), err),
      ),
    );
  }
}

let basisTypeEnvCache: Map<string, TypeInfo> | undefined;

export function baseTypeEnv(options: BasisOptions = {}): TypeEnv {
  if (!basisTypeEnvCache) {
    basisTypeEnvCache = new Map(
      ["Number", "Bool", "String", "Void", "Js.Value", "Js.Object"].map((name) => [
        name,
        { ...freshTypeInfo(name, 0), basis: true },
      ]),
    );
    basisTypeEnvCache.set("Js.Array", {
      ...freshTypeInfo("Js.Array", 1),
      basis: true,
      argLabels: ["element"],
    });
    // An array-like / buffer-source obligation. Reflected JS parameters typed as
    // ArrayBuffer/BufferSource/AllowSharedBufferSource land here instead of opaque Js.Object;
    // a call site resolves it to the concrete array-like argument type during FFI
    // materialization (see resolveArrayLikeParams), so it stays safe rather than accepting
    // anything like a broad Js.Value would.
    basisTypeEnvCache.set("Js.ArrayLike", {
      ...freshTypeInfo("Js.ArrayLike", 0),
      basis: true,
    });
    basisTypeEnvCache.set("Js.Dict", {
      ...freshTypeInfo("Js.Dict", 1),
      basis: true,
      argLabels: ["value"],
    });
    basisTypeEnvCache.set("Gpu.Color", {
      ...freshTypeInfo("Gpu.Color", 0),
      basis: true,
    });
    basisTypeEnvCache.set("Gpu.Fragment", {
      ...freshTypeInfo("Gpu.Fragment", 0),
      basis: true,
    });
    basisTypeEnvCache.set("Gpu.Uniform", {
      ...freshTypeInfo("Gpu.Uniform", 1),
      basis: true,
      argLabels: ["value"],
    });
    for (
      const name of [
        "Gpu.Texture2D",
        "Gpu.SampledTexture2D",
        "Gpu.RenderTarget2D",
        "Gpu.Sampler",
      ]
    ) {
      basisTypeEnvCache.set(name, {
        ...freshTypeInfo(name, 0),
        basis: true,
      });
    }
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
  const result = new Map(basisTypeEnvCache);
  if (options.includeAlgebraicBasis === false) {
    for (const type of basisTypes) result.delete(type.name);
    result.delete("Task");
  }
  return result;
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
  {
    const a = fresh("a") as Extract<Ty, { tag: "var" }>;
    const b = fresh("b") as Extract<Ty, { tag: "var" }>;
    const e = fresh("e") as Extract<Ty, { tag: "var" }>;
    env.set("Result", {
      vars: [a.id, b.id, e.id],
      type: structural([
        {
          name: "fn",
          type: fn(
            [fn([a], named(result, [b, e]))],
            fn([named(result, [a, e])], named(result, [b, e])),
          ),
        },
      ]),
      status: "value",
      basis: true,
    });
  }
  const input = fresh("input") as Extract<Ty, { tag: "var" }>;
  const output = fresh("output") as Extract<Ty, { tag: "var" }>;
  const textValue = fresh("value") as Extract<Ty, { tag: "var" }>;
  env.set("Result.textOf", {
    vars: [textValue.id],
    type: fn([textValue], StringTy),
    status: "value",
    basis: true,
  });
  env.set("Json.assert", {
    vars: [input.id, output.id],
    type: fn([input], named(result, [output, named(jsError)])),
    status: "value",
    basis: true,
  });
  addTaskValues(env, typeEnv);
  addJsArrayValues(env, typeEnv);
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

function addJsArrayValues(env: Env, typeEnv: TypeEnv) {
  const jsArray = typeEnv.get("Js.Array");
  const listInfo = typeEnv.get("List");
  if (!jsArray || !listInfo) return;
  const basisFn = (name: string, vars: Extract<Ty, { tag: "var" }>[], type: Ty) => {
    env.set(name, { vars: vars.map((v) => v.id), type, status: "value", basis: true });
  };
  const a = fresh("a") as Extract<Ty, { tag: "var" }>;
  basisFn("Js.Array.toList", [a], fn([named(jsArray, [a])], named(listInfo, [a])));
  const b = fresh("b") as Extract<Ty, { tag: "var" }>;
  basisFn("Js.Array.fromList", [b], fn([named(listInfo, [b])], named(jsArray, [b])));
}
