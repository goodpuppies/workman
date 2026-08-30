import {
  type JsReflectionProfileEvent,
  prepareReflectionSources,
  setJsReflectionProfileSink,
} from "../src/ffi/reflect/host.ts";
import { initialJsImportReflectionRequests } from "../src/ffi/reflect/types.ts";
import { resolveLocalJsModuleSpecifiers } from "../src/js_module_specifier.ts";
import { loadModuleGraph } from "../src/module_graph.ts";
import { dirname, join } from "node:path";

const input = Deno.args.find((arg) => !arg.startsWith("--")) ??
  "../wmthree/src/scripts/play.wm";
const only = Deno.args.find((arg) => arg.startsWith("--only="))?.slice("--only=".length) ?? "all";
const limit = Number(
  Deno.args.find((arg) => arg.startsWith("--limit="))?.slice("--limit=".length) ??
    "0",
);
const graph = await loadModuleGraph(input);
for (const node of graph.nodes.values()) {
  node.module = resolveLocalJsModuleSpecifiers(node.module, node.path);
}
const allRequests = initialJsImportReflectionRequests(
  [...graph.nodes.values()].map((node) => ({
    filePath: node.path,
    decls: node.module.decls.filter((decl) => decl.kind === "JsImportDecl"),
  })),
);
const selectedRequests = only.startsWith("three-direct")
  ? directThreeRequests(only, dirname(graph.entry))
  : allRequests.filter((request) => selected(request.label, only));
const requests = limit > 0 ? selectedRequests.slice(0, limit) : selectedRequests;
const events: JsReflectionProfileEvent[] = [];
setJsReflectionProfileSink((event) => events.push(event));
const started = performance.now();
try {
  prepareReflectionSources(requests);
} finally {
  setJsReflectionProfileSink(undefined);
}
const batch = events.find((event) => event.kind === "batch");
if (!batch) throw new Error(`initial reflection selection ${only} produced no batch`);

console.log(`initial reflection: ${only}`);
console.log(`requests: ${requests.length}, roots: ${batch.roots}`);
console.log(`wall: ${ms(performance.now() - started)}`);
console.log(`graph discovery: ${ms(batch.graphMs)}`);
console.log(`createProgram: ${ms(batch.programMs)}`);
console.log(`getTypeChecker: ${ms(batch.checkerMs)}`);
console.log(`program: ${batch.programFiles} files, ${batch.programSourceBytes} source bytes`);
console.log("largest files:");
for (const file of batch.largestProgramFiles.slice(0, 8)) {
  console.log(`  ${file.sourceBytes} ${file.fileName}`);
}

function selected(label: string, selection: string): boolean {
  switch (selection) {
    case "all":
      return true;
    case "three":
      return label.includes("three/webgpu");
    case "rapier":
      return label.includes("@dimforge/rapier") || label.includes("rapier_helpers");
    case "bridges":
      return label.includes("three_helpers");
    case "globals":
      return label.startsWith("global");
    case "modules":
      return label.startsWith("module:");
    case "without-three":
      return !label.includes("three/webgpu");
    case "without-rapier":
      return !label.includes("@dimforge/rapier") && !label.includes("rapier_helpers");
    default:
      throw new Error(`unknown --only selection ${selection}`);
  }
}

function directThreeRequests(selection: string, baseDirectory: string) {
  const fileName = join(baseDirectory, "__wm_js_reflect_three_direct.ts");
  const coreImports = `
import { Scene } from "three/src/scenes/Scene.js";
import { Group } from "three/src/objects/Group.js";
import { PerspectiveCamera } from "three/src/cameras/PerspectiveCamera.js";
import { BoxGeometry } from "three/src/geometries/BoxGeometry.js";
import { PlaneGeometry } from "three/src/geometries/PlaneGeometry.js";
import { MeshStandardMaterial } from "three/src/materials/MeshStandardMaterial.js";
import { Mesh } from "three/src/objects/Mesh.js";
import { Color } from "three/src/math/Color.js";
import { HemisphereLight } from "three/src/lights/HemisphereLight.js";
import { DirectionalLight } from "three/src/lights/DirectionalLight.js";
import { PointLight } from "three/src/lights/PointLight.js";`;
  const rendererImport = `
import WebGPURenderer from "three/src/renderers/webgpu/WebGPURenderer.js";`;
  const targets = selection === "three-direct-renderer"
    ? "WebGPURenderer"
    : selection === "three-direct-core"
    ? "Scene, Group, PerspectiveCamera, BoxGeometry, PlaneGeometry, MeshStandardMaterial, Mesh, Color, HemisphereLight, DirectionalLight, PointLight"
    : "Scene, Group, PerspectiveCamera, BoxGeometry, PlaneGeometry, MeshStandardMaterial, Mesh, Color, HemisphereLight, DirectionalLight, PointLight, WebGPURenderer";
  const source = `// @wm-reflect-file ${JSON.stringify(fileName)}
${selection === "three-direct-renderer" ? "" : coreImports}
${selection === "three-direct-core" ? "" : rendererImport}
const __wm_targets = [${targets}];`;
  return [{ label: "three-direct", source }];
}

function ms(value: number): string {
  return `${value.toFixed(1)}ms`;
}
