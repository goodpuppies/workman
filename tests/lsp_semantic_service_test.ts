import { assertEquals, assertNotStrictEquals, assertStrictEquals } from "@std/assert";
import { SemanticService } from "../src/lsp/semantic_service.ts";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { fileUriToPath, pathToFileUri } from "../src/lsp/uri.ts";
import { validateUri } from "../src/lsp/validation.ts";

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

Deno.test("semantic service retries an unfinished empty match arm with a synthetic hole", async () => {
  const dir = await Deno.makeTempDir();
  const path = `${dir}/note.wm`;
  const source = "let choose = match(true) { true => { 1 }, false => {  } }; " +
    "let identity = (item) => { item };";
  await Deno.writeTextFile(path, source);
  const index = new ProjectIndex();
  const overrides = new Map([[path, source]]);
  await index.refreshFile(path, overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  const context = await service.documentContext(pathToFileUri(path));

  assertEquals(context?.recovered, true);
  assertEquals(context?.moduleInterface.occurrences.some(({ name }) => name === "identity"), true);
  assertEquals(context?.recoveryHoles, [{
    id: source.indexOf("  }") + 1,
    anchor: source.indexOf("  }") + 1,
    diagnosticCode: "type.match-arm-results-disagree",
  }]);
  assertEquals(
    service.strictFailure(context!.project) instanceof Error,
    true,
  );

  const edited = source.replace("identity", "identity2");
  overrides.set(path, edited);
  await service.invalidatePaths([path]);
  const editedContext = await service.documentContext(pathToFileUri(path));
  assertEquals(
    (service.strictFailure(editedContext!.project) as Error).message.includes(
      "editor analysis inserted `?`",
    ),
    true,
  );
  assertEquals(
    editedContext?.moduleInterface.occurrences.some(({ name }) => name === "identity2"),
    true,
  );
});

Deno.test("semantic service keeps an imported parse failure on its source module", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const lib = `${dir}/lib.wm`;
  await Deno.writeTextFile(
    main,
    'from "./lib.wm" import { value }; let main = () => { value };',
  );
  await Deno.writeTextFile(lib, "let value = )");
  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({ workspaceFolders: [{ uri: pathToFileUri(dir) }] });
  const overrides = new Map<string, string>();
  await index.initialize(overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  const results = await validateUri(pathToFileUri(main), overrides, {}, {
    semanticService: service,
  });
  const byPath = new Map(results.map((result) => [fileUriToPath(result.uri), result.diagnostics]));

  assertEquals(byPath.get(main), []);
  assertEquals(byPath.get(lib)?.map((diagnostic) => diagnostic.code), ["parse.syntax-error"]);
  assertEquals(byPath.get(lib)?.[0].range.start, { line: 0, character: 12 });
});

Deno.test("editing a dependency dropped by recovery invalidates its stale headed diagnostic", async () => {
  const dir = await Deno.makeTempDir();
  const main = `${dir}/main.wm`;
  const lib = `${dir}/lib.wm`;
  const mainSource = 'from "./lib.wm" import { value }; let main = () => { value };';
  const broken = "let value = Token.;";
  const fixed = "let value = 1 + true;";
  await Deno.writeTextFile(main, mainSource);
  await Deno.writeTextFile(lib, broken);
  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({ workspaceFolders: [{ uri: pathToFileUri(dir) }] });
  const overrides = new Map<string, string>();
  await index.initialize(overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  const before = await validateUri(pathToFileUri(main), overrides, {}, {
    semanticService: service,
  });
  assertEquals(
    before.flatMap(({ diagnostics }) => diagnostics.map(({ code }) => code)),
    ["parse.syntax-error"],
  );

  overrides.set(lib, fixed);
  await service.invalidatePaths([lib]);
  const after = await validateUri(pathToFileUri(main), overrides, {}, {
    semanticService: service,
  });

  assertEquals(
    after.flatMap(({ diagnostics }) => diagnostics.map(({ code }) => code)),
    ["type.mismatch"],
  );
});
