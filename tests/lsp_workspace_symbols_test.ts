import { assertEquals } from "@std/assert";
import { ProjectIndex } from "../src/lsp/project_index.ts";
import { SemanticService } from "../src/lsp/semantic_service.ts";
import { pathToFileUri } from "../src/lsp/uri.ts";
import { workspaceSymbols } from "../src/lsp/workspace_symbols.ts";

Deno.test("workspace symbols aggregate active projects without enrolling indexed files", async () => {
  const dir = await Deno.makeTempDir();
  const app = `${dir}/app.wm`;
  const shared = `${dir}/shared.wm`;
  const test = `${dir}/test.wm`;
  const testOnly = `${dir}/test_only.wm`;
  const unrelated = `${dir}/unrelated.wm`;
  await Promise.all([
    Deno.writeTextFile(
      app,
      'from "./shared.wm" import { make }; let main = () => { make() };',
    ),
    Deno.writeTextFile(
      shared,
      "type Option<T> = None | Some<T>; let make = () => { Some(1) };",
    ),
    Deno.writeTextFile(
      test,
      'from "./shared.wm" import { make }; from "./test_only.wm" import { helper }; ' +
        "let main = () => { (make(), helper) };",
    ),
    Deno.writeTextFile(testOnly, "let helper = 2;"),
    Deno.writeTextFile(unrelated, "let unrelated = 3;"),
  ]);
  const overrides = new Map<string, string>();
  const index = new ProjectIndex();
  index.rememberWorkspaceRoots({
    workspaceFolders: [{ uri: pathToFileUri(dir), name: "test" }],
  });
  await index.initialize(overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });

  assertEquals(await workspaceSymbols("", service, overrides), []);
  await service.documentContext(pathToFileUri(app));
  const application = await workspaceSymbols("", service, overrides);
  assertEquals(application.some(({ name }) => name === "unrelated"), false);
  assertEquals(application.some(({ name, kind }) => name === "app" && kind === 2), true);
  assertEquals(application.some(({ name, kind }) => name === "make" && kind === 12), true);
  assertEquals(
    application.find(({ name }) => name === "Some")?.containerName,
    "Option",
  );

  await service.documentContext(pathToFileUri(testOnly));
  const overlapping = await workspaceSymbols("", service, overrides);
  assertEquals(overlapping.filter(({ name }) => name === "make").length, 1);
  assertEquals(overlapping.some(({ name }) => name === "helper"), true);
  assertEquals(overlapping.some(({ name }) => name === "test"), true);
  assertEquals(
    (await workspaceSymbols("so", service, overrides)).map(({ name }) => name),
    ["Some"],
  );
});

Deno.test("workspace symbols include open detached contexts only while they remain open", async () => {
  const dir = await Deno.makeTempDir();
  const note = `${dir}/note.wm`;
  await Deno.writeTextFile(note, "let noteValue = 1;");
  const overrides = new Map<string, string>();
  const index = new ProjectIndex();
  await index.refreshFile(note, overrides);
  const service = new SemanticService(index.discovery, {
    sourceOverrides: () => overrides,
    frontendOptions: () => ({}),
  });
  const uri = pathToFileUri(note);

  await service.documentContext(uri);
  assertEquals(
    (await workspaceSymbols("note", service, overrides)).map(({ name }) => name),
    ["note", "noteValue"],
  );
  await service.closeDocument(uri);
  assertEquals(await workspaceSymbols("note", service, overrides), []);
});
