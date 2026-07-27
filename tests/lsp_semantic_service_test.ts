import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { SemanticService } from "../src/lsp/semantic_service.ts";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";

Deno.test("semantic service reuses closest-head snapshots and isolates overlapping projects", async () => {
  const dir = await Deno.makeTempDir();
  const app = `${dir}/app.wm`;
  const shared = `${dir}/shared.wm`;
  const test = `${dir}/test.wm`;
  const testOnly = `${dir}/test_only.wm`;
  await Promise.all([
    Deno.writeTextFile(
      app,
      'from "./shared.wm" import { value }; let main = () => { value };',
    ),
    Deno.writeTextFile(shared, "let value = 1;"),
    Deno.writeTextFile(
      test,
      'from "./shared.wm" import { value }; from "./test_only.wm" import { helper }; ' +
        "let main = () => { value + helper };",
    ),
    Deno.writeTextFile(testOnly, "let helper = 2;"),
  ]);
  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({
    workspaceFolders: [{ uri: pathToFileUri(dir), name: "test" }],
  });
  const overrides = new Map<string, string>();
  await index.initialize(overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  const application = await service.documentContext(pathToFileUri(app));
  const sharedFromApplication = await service.documentContext(pathToFileUri(shared));
  const tests = await service.documentContext(pathToFileUri(testOnly));
  const sharedAgain = await service.documentContext(pathToFileUri(shared));

  assertEquals(application?.project.kind, "headed");
  assertStrictEquals(sharedFromApplication?.project, application?.project);
  assertNotStrictEquals(tests?.project, application?.project);
  assertStrictEquals(sharedAgain?.project, application?.project);
  assertEquals(service.openSnapshots().length, 2);

  await service.invalidatePaths([shared]);
  const refreshedApplication = await service.documentContext(pathToFileUri(app));
  const refreshedTests = await service.documentContext(pathToFileUri(testOnly));
  assertNotStrictEquals(refreshedApplication?.project, application?.project);
  assertNotStrictEquals(refreshedTests?.project, tests?.project);
});

Deno.test("semantic service keeps strict diagnostics beside recovered current interfaces", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/note.wm`;
  await Deno.writeTextFile(path, "let good = 1; let bad = 1 + true;");
  const index = new ProjectIndex();
  const overrides = new Map<string, string>();
  await index.refreshFile(path, overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  const context = await service.documentContext(pathToFileUri(path));

  assertEquals(context?.project.kind, "detached");
  assertEquals(context?.recovered, true);
  assertEquals(context?.moduleInterface.occurrences.some(({ name }) => name === "good"), true);
  assertEquals(context?.moduleInterface.occurrences.some(({ name }) => name === "bad"), false);
  assertEquals(service.strictFailure(context!.project) instanceof Error, true);
  assertStrictEquals(
    (await service.documentContext(pathToFileUri(path)))?.project,
    context?.project,
  );
});
