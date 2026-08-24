import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { dirname, normalize, posix } from "node:path";
import { analyzeDetachedVirtual, analyzeRecoveredVirtual } from "../src/compiler.ts";
import { ProjectContextRegistry, ReverseImportDiscoveryIndex } from "../src/project_context.ts";
import {
  semanticDefinitionsForTarget,
  semanticOccurrencesForTarget,
} from "../src/module_interface.ts";
import { moduleId } from "../src/module_id.ts";

const configuration = "v1:workman";

Deno.test("[module update A612-A615] open documents activate only uncovered closest-head projects", async () => {
  const files = new Map<string, string>([
    [
      "/ws/main.wm",
      'from "./barrel.wm" import * as Barrel; ' +
      'from "./lib3/core.wm" import { core }; let main = () => { core };',
    ],
    ["/ws/barrel.wm", "let main = () => { 0 };"],
    ["/ws/lib3/core.wm", "let core = 1;"],
    [
      "/ws/lib3/test.wm",
      'from "./core.wm" import { core }; from "./test_only.wm" import { helper }; ' +
      "let main = () => { core + helper };",
    ],
    ["/ws/lib3/test_only.wm", "let helper = 2;"],
    ["/ws/isolated.wm", "let note = 3;"],
  ]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  const analyzeHead = (head: string) => analyzeRecoveredVirtual(head, files);
  const analyzeDetached = (path: string) => analyzeDetachedVirtual(path, files);

  const application = await registry.openDocument(
    "/ws/main.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(application.reason, "closest-head");
  assertEquals(application.snapshot.kind, "headed");
  assertEquals(registry.activeSnapshots().length, 1);
  assertEquals(discovery.closestHeadQueries, 1);

  // A main-bearing dependency remains an ordinary dependency because an active graph reaches it.
  const barrel = await registry.openDocument(
    "/ws/barrel.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(barrel.reason, "active-reachable");
  assertStrictEquals(barrel.snapshot, application.snapshot);
  assertEquals(discovery.closestHeadQueries, 1);
  assertEquals(registry.activeSnapshots().length, 1);

  const shared = await registry.openDocument(
    "/ws/lib3/core.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertStrictEquals(shared.snapshot, application.snapshot);
  assertEquals(discovery.closestHeadQueries, 1);

  // This file is outside the application graph, so reverse discovery selects lib3's closest head.
  const libraryTests = await registry.openDocument(
    "/ws/lib3/test_only.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(libraryTests.reason, "closest-head");
  assertNotStrictEquals(libraryTests.snapshot, application.snapshot);
  assertEquals(registry.activeSnapshots().length, 2);
  assertEquals(discovery.closestHeadQueries, 2);

  const overlapping = registry.contextsForPath("/ws/lib3/core.wm");
  assertEquals(overlapping.length, 2);
  assertNotStrictEquals(overlapping[0].id, overlapping[1].id);
  const sharedAgain = await registry.openDocument(
    "/ws/lib3/core.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertStrictEquals(sharedAgain.snapshot, application.snapshot);
  assertEquals(discovery.closestHeadQueries, 2);

  const detached = await registry.openDocument(
    "/ws/isolated.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(detached.reason, "detached");
  assertEquals(detached.snapshot.kind, "detached");
  assertEquals(registry.activeSnapshots().length, 2);
  assertEquals(discovery.closestHeadQueries, 3);
});

Deno.test("[module update A613/A615] reverse discovery stops at the closest head", async () => {
  const files = new Map<string, string>([
    ["/ws/outer.wm", 'from "./lib/test.wm" import * as Test; let main = () => { 0 };'],
    [
      "/ws/lib/test.wm",
      'from "./implementation.wm" import { value }; let main = () => { value };',
    ],
    ["/ws/lib/implementation.wm", "let value = 1;"],
  ]);
  const discovery = await discoveryIndex(files);

  assertEquals(discovery.closestHead("/ws/lib/implementation.wm"), "/ws/lib/test.wm");
  assertEquals(discovery.closestHead("/ws/lib/test.wm"), "/ws/lib/test.wm");
  assertEquals(discovery.closestHead("/ws/outer.wm"), "/ws/outer.wm");
  assertEquals(discovery.headsFor("/ws/lib/implementation.wm"), [
    "/ws/lib/test.wm",
    "/ws/outer.wm",
  ]);
});

Deno.test("an uncertified closest-head import falls back to a detached document context", async () => {
  const files = new Map<string, string>([
    [
      "/ws/main.wm",
      'from "./lexer.wm" import { lex }; let main = () => { lex("") };',
    ],
    ["/ws/lexer.wm", "let lex = (source) => { missing };"],
  ]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  let headedAnalyses = 0;
  const analyzeHead = (head: string) => {
    headedAnalyses++;
    return analyzeRecoveredVirtual(head, files);
  };
  const analyzeDetached = (path: string) => analyzeDetachedVirtual(path, files);

  const lexer = await registry.openDocument(
    "/ws/lexer.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );

  assertEquals(lexer.reason, "detached");
  assertEquals(lexer.snapshot.kind, "detached");
  assertEquals(
    [...lexer.snapshot.interfaces.values()].some(({ path }) => path === "/ws/lexer.wm"),
    true,
  );
  assertEquals(registry.activeSnapshots().length, 1);

  registry.invalidatePaths(["/ws/lexer.wm"]);
  assertEquals(registry.activeSnapshots().length, 0);
  await registry.openDocument(
    "/ws/lexer.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  await registry.openDocument(
    "/ws/main.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(headedAnalyses, 2);
});

Deno.test("reverse discovery prefers a directory-local head at equal import distance", async () => {
  const files = new Map<string, string>([
    [
      "/ws/orbital/main.wm",
      'from "./color.wm" import { Color }; let main = () => { Color };',
    ],
    [
      "/ws/colony/main3d.wm",
      'from "../orbital/color.wm" import { Color }; let main = () => { Color };',
    ],
    ["/ws/orbital/color.wm", "record Color = { r: Number };"],
  ]);
  const discovery = await discoveryIndex(files);

  assertEquals(discovery.closestHead("/ws/orbital/color.wm"), "/ws/orbital/main.wm");
});

Deno.test("[module update A612] project configuration is part of active context identity", async () => {
  const files = new Map([["/ws/main.wm", "let main = () => { 0 };"]]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  const analyzeHead = (head: string) => analyzeRecoveredVirtual(head, files);
  const analyzeDetached = (path: string) => analyzeDetachedVirtual(path, files);

  const v1 = await registry.openDocument(
    "/ws/main.wm",
    "v1:workman",
    analyzeHead,
    analyzeDetached,
  );
  const v2 = await registry.openDocument(
    "/ws/main.wm",
    "v2:workman",
    analyzeHead,
    analyzeDetached,
  );

  assertNotStrictEquals(v1.snapshot.id, v2.snapshot.id);
  assertEquals(registry.activeSnapshots().length, 2);
});

Deno.test("[module update A612] changed closures invalidate and closed contexts are released", async () => {
  const files = new Map<string, string>([
    ["/ws/main.wm", 'from "./lib.wm" import { value }; let main = () => { value };'],
    ["/ws/lib.wm", "let value = 1;"],
    ["/ws/note.wm", "let note = 2;"],
  ]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  let headedAnalyses = 0;
  let detachedAnalyses = 0;
  const analyzeHead = (head: string) => {
    headedAnalyses++;
    return analyzeRecoveredVirtual(head, files);
  };
  const analyzeDetached = (path: string) => {
    detachedAnalyses++;
    return analyzeDetachedVirtual(path, files);
  };

  const first = await registry.openDocument(
    "/ws/main.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  await registry.openDocument(
    "/ws/lib.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  const detached = await registry.openDocument(
    "/ws/note.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertEquals(headedAnalyses, 1);
  assertEquals(detachedAnalyses, 1);
  assertEquals(registry.openSnapshots().length, 2);

  registry.invalidatePaths(["/ws/lib.wm"]);
  const refreshed = await registry.openDocument(
    "/ws/main.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertNotStrictEquals(refreshed.snapshot, first.snapshot);
  assertEquals(headedAnalyses, 2);
  assertStrictEquals(registry.openSnapshots()[1], detached.snapshot);

  registry.forgetDocument("/ws/note.wm", configuration);
  assertEquals(registry.openSnapshots().some((snapshot) => snapshot === detached.snapshot), false);
});

Deno.test("closing a project's anchor reselects its remaining open documents", async () => {
  const files = new Map<string, string>([
    [
      "/ws/run/main.wm",
      'from "../orbital/bridge.wm" import { bridge }; let main = () => { bridge };',
    ],
    [
      "/ws/orbital/main.wm",
      'from "./vec.wm" import { value }; let main = () => { value };',
    ],
    ["/ws/orbital/bridge.wm", 'from "./vec.wm" import { value }; let bridge = value;'],
    ["/ws/orbital/vec.wm", "let value = 1;"],
  ]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  const analyzeHead = (head: string) => analyzeRecoveredVirtual(head, files);
  const analyzeDetached = (path: string) => analyzeDetachedVirtual(path, files);

  const bridge = await registry.openDocument(
    "/ws/orbital/bridge.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  const covered = await registry.openDocument(
    "/ws/orbital/vec.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  assertStrictEquals(covered.snapshot, bridge.snapshot);

  registry.forgetDocument("/ws/orbital/bridge.wm", configuration);
  const reselected = await registry.openDocument(
    "/ws/orbital/vec.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );

  assertNotStrictEquals(reselected.snapshot, bridge.snapshot);
  assertEquals(reselected.snapshot.head, moduleId("/ws/orbital/main.wm"));
});

Deno.test("[module update G21a] overlapping project snapshots isolate every semantic artifact", async () => {
  const sharedSource = "record First = { x: Number }; record Second = { x: Number }; " +
    "let read = (value) => { value.x };";
  const files = new Map<string, string>([
    [
      "/ws/app.wm",
      'from "./shared.wm" import { read }; from "./app_only.wm" import { appOnly }; ' +
      "let main = () => { appOnly };",
    ],
    ["/ws/app_only.wm", "let appOnly = 1;"],
    [
      "/ws/test.wm",
      'from "./shared.wm" import { read }; from "./test_only.wm" import { testOnly }; ' +
      "let main = () => { testOnly };",
    ],
    ["/ws/test_only.wm", "let testOnly = 2;"],
    ["/ws/shared.wm", sharedSource],
  ]);
  const discovery = await discoveryIndex(files);
  const registry = new ProjectContextRegistry(discovery);
  const analyzeHead = (head: string) => analyzeRecoveredVirtual(head, files);
  const analyzeDetached = (path: string) => analyzeDetachedVirtual(path, files);

  const application = await registry.openDocument(
    "/ws/app_only.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  const tests = await registry.openDocument(
    "/ws/test_only.wm",
    configuration,
    analyzeHead,
    analyzeDetached,
  );
  const sharedId = moduleId("/ws/shared.wm");
  const appInterface = application.snapshot.interfaces.get(sharedId)!;
  const testInterface = tests.snapshot.interfaces.get(sharedId)!;

  assertEquals(registry.contextsForPath("/ws/shared.wm").length, 2);
  assertNotStrictEquals(application.snapshot.id, tests.snapshot.id);
  assertNotStrictEquals(appInterface, testInterface);
  assertStrictEquals(appInterface.projectSnapshotId, application.snapshot.id);
  assertStrictEquals(testInterface.projectSnapshotId, tests.snapshot.id);
  assertNotStrictEquals(appInterface.generation, testInterface.generation);
  assertNotStrictEquals(appInterface.diagnostics, testInterface.diagnostics);
  assertNotStrictEquals(appInterface.diagnostics[0], testInterface.diagnostics[0]);
  assertEquals(appInterface.diagnostics.map((item) => item.code), [
    "record.ambiguous-projection",
  ]);
  assertEquals(testInterface.diagnostics.map((item) => item.code), [
    "record.ambiguous-projection",
  ]);
  assertNotStrictEquals(appInterface.occurrences, testInterface.occurrences);
  assertNotStrictEquals(appInterface.scopes, testInterface.scopes);
  assertNotStrictEquals(appInterface.typedNodes, testInterface.typedNodes);
  assertNotStrictEquals(appInterface.semanticTypes, testInterface.semanticTypes);

  const appType = appInterface.occurrences.find((item) =>
    item.name === "First" && item.role === "declaration" && item.target.kind === "type"
  )!;
  const testType = testInterface.occurrences.find((item) =>
    item.name === "First" && item.role === "declaration" && item.target.kind === "type"
  )!;
  // Numeric compiler IDs may repeat between snapshots; their owner is the ProjectSnapshot.
  assertEquals(appType.target, testType.target);
  assertEquals(
    semanticOccurrencesForTarget(application.snapshot, appType.target).some(({ occurrence }) =>
      occurrence === testType
    ),
    false,
  );
  assertEquals(
    semanticOccurrencesForTarget(tests.snapshot, testType.target).some(({ occurrence }) =>
      occurrence === appType
    ),
    false,
  );

  const appDefinition = semanticDefinitionsForTarget(
    application.snapshot,
    appType.target,
  )[0];
  const testDefinition = semanticDefinitionsForTarget(
    tests.snapshot,
    testType.target,
  )[0];
  assertStrictEquals(appDefinition.occurrence, appType);
  assertStrictEquals(testDefinition.occurrence, testType);
  assertNotStrictEquals(appDefinition.occurrence, testDefinition.occurrence);
});

async function discoveryIndex(
  files: ReadonlyMap<string, string>,
): Promise<ReverseImportDiscoveryIndex> {
  const index = new ReverseImportDiscoveryIndex();
  for (const [path, source] of files) {
    await index.update(path, source, (referrer, specifier) => {
      const resolved = normalize(posix.join(dirname(referrer), specifier));
      return files.has(resolved) ? resolved : undefined;
    });
  }
  return index;
}
