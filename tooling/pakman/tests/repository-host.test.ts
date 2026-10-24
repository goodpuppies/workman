import { join } from "node:path";
import { recipeSource, repositoryLocator, repositoryRecipe } from "../src/repository-host.ts";
import { compileProgram } from "../src/host.ts";

const wm = new URL("../../../src/main.ts", import.meta.url).pathname;
const fixtures = new URL("./pkgs", import.meta.url).pathname;

function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}

async function command(cmd: string, args: string[], env: Record<string, string> = {}) {
  const result = await new Deno.Command(cmd, { args, env, stdout: "piped", stderr: "piped" })
    .output();
  return {
    code: result.code,
    output: new TextDecoder().decode(result.stdout) + new TextDecoder().decode(result.stderr),
  };
}

async function run(args: string[], env: Record<string, string>) {
  const result = await command(Deno.execPath(), ["run", "-A", wm, "pakman", ...args], env);
  assert(result.code === 0, result.output);
  return result.output;
}

function recipe(dest: string): string {
  return `from "pakman/model.wm" import *;
from "pakman/package.wm" import { serve };
from "pakman/repository.wm" import * as Repository;
let make = (version, _) => {
  Package(version, [Repository.source("source.tar")], [
    extract("source.tar", ".local/share/${dest}", 1),
    WriteText(".local/bin/${dest}", cat([lit("#!/bin/sh\\ncat "), shellRef(Own(".local/share/${dest}/data")), lit("\\nexec "), shellRef(file(package("private-wm", "~0.4.1"), ".local/bin/private-wm")), lit("\\n")]), Exec)
  ], [])
};
let definition: Definition = .{
  name = "same-display-name", description = "fixture", homepage = "", license = "MIT",
  target = Host, scope = User, versions = Repository.versions, hosts = [],
  policy = .{ ..defaultPolicy, channel = "source", minAgeDays = 0 }, make
};
let main = () => { serve(definition) };
`;
}

async function createRepository(root: string, dest: string) {
  await Deno.mkdir(root);
  const init = await command("git", ["init", "--quiet", root]);
  assert(init.code === 0, init.output);
  await Deno.writeTextFile(join(root, ".gitignore"), ".env\n");
  await Deno.writeTextFile(join(root, ".env"), "PRIVATE=must-not-be-packaged\n");
  await Deno.writeTextFile(join(root, "data"), "first\n");
  await Deno.writeTextFile(join(root, "pak.wm"), recipe(dest));
}

Deno.test("repository installs own their source and dependencies across update, rollback, and other profiles", async () => {
  // Spaces, shell metacharacters and apostrophes must survive launcher rendering.
  const base = await Deno.makeTempDir({ prefix: "pakman-repo-'$ " });
  try {
    const repo = join(base, "repo");
    await createRepository(repo, "repo-app");
    const locator = "github.com/example/application";
    const root = join(base, "profile");
    const env = {
      PAKMAN_STATE: join(base, "state"),
      PAKMAN_PKGS: fixtures,
      PAKMAN_REPOSITORIES: JSON.stringify({ [locator]: repo }),
    };
    await run(["install", locator, "--root", root], env);
    const invoke = () => command(join(root, ".local/bin/repo-app"), []);
    let result = await invoke();
    assert(result.code === 0 && result.output === "first\n2.8.10\n", result.output);
    assert(
      !await Deno.stat(join(root, ".local/share/repo-app/.env")).then(() => true, () => false),
      "ignored credentials were copied",
    );
    assert(
      !await Deno.stat(join(root, ".local/bin/private-wm")).then(() => true, () => false),
      "private WM was exposed",
    );

    await Deno.writeTextFile(join(repo, "data"), "second\n");
    // Refreshing the same locator in another profile must not change root's lock.
    await run(["install", locator, "--root", join(base, "other-profile")], env);
    await run(["build", locator, "--root", root], { ...env, PAKMAN_REPOSITORIES: "{}" });
    result = await invoke();
    assert(result.output === "first\n2.8.10\n", result.output);
    await run(["update", "--root", root], env);
    result = await invoke();
    assert(result.output === "second\n2.8.10\n", result.output);
    await run(["rollback", "--root", root], env);
    result = await invoke();
    assert(result.output === "first\n2.8.10\n", result.output);

    // Equal declared names in independent repositories remain distinct providers.
    const secondRepo = join(base, "second-repo");
    await createRepository(secondRepo, "another-app");
    const second = "github.com/another/application";
    await run(["install", second, "--root", root], {
      ...env,
      PAKMAN_REPOSITORIES: JSON.stringify({ [second]: secondRepo }),
    });
    assert(
      (await invoke()).output === "first\n2.8.10\n",
      "another provider replaced the first recipe",
    );
    result = await command(join(root, ".local/bin/another-app"), []);
    assert(result.output === "first\n2.8.10\n", result.output);
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("repository locations and package API imports reject ambiguous or escaping paths", () => {
  assert(
    repositoryLocator("github.com/owner/repo#feature/foo").ref === "feature/foo",
    "branch reference lost",
  );
  for (
    const input of [
      "github.com/owner/..",
      "github.com/owner/repo/other",
      "https://elsewhere/owner/repo",
    ]
  ) {
    let rejected = false;
    try {
      repositoryLocator(input);
    } catch {
      rejected = true;
    }
    assert(rejected, `accepted ${input}`);
  }
});

Deno.test("local snapshots require pak.wm and recipe resources cannot escape", async () => {
  const base = await Deno.makeTempDir();
  const previous = Deno.env.get("PAKMAN_REPOSITORIES");
  try {
    const repo = join(base, "repo");
    await createRepository(repo, "app");
    const locator = "github.com/example/local";
    Deno.env.set("PAKMAN_REPOSITORIES", JSON.stringify({ [locator]: repo }));
    const source = await repositoryRecipe(join(base, "state"), locator);
    const program = join(base, "program.js");
    await Deno.writeTextFile(`${program}.source`, source);
    let rejected = false;
    try {
      await recipeSource(program, "pak:recipe/../../.env");
    } catch {
      rejected = true;
    }
    assert(rejected, "recipe resource escaped its root");
    await Deno.remove(join(repo, "pak.wm"));
    rejected = false;
    try {
      await repositoryRecipe(join(base, "state"), locator, true);
    } catch {
      rejected = true;
    }
    assert(rejected, "repository without pak.wm accepted");
    assert(
      await repositoryRecipe(join(base, "state"), locator) === source,
      "failed refresh changed the current recipe",
    );
  } finally {
    if (previous === undefined) Deno.env.delete("PAKMAN_REPOSITORIES");
    else Deno.env.set("PAKMAN_REPOSITORIES", previous);
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("GitHub fetching binds recipe and source to the returned immutable commit", async () => {
  const base = await Deno.makeTempDir();
  const originalFetch = globalThis.fetch;
  const previous = Deno.env.get("PAKMAN_REPOSITORIES");
  try {
    Deno.env.set("PAKMAN_REPOSITORIES", "{}");
    const upstream = join(base, "upstream");
    await createRepository(upstream, "app");
    await Deno.remove(join(upstream, ".git"), { recursive: true });
    const archive = join(base, "source.tar");
    const tar = await command("bsdtar", ["-cf", archive, "-C", base, "upstream"]);
    assert(tar.code === 0, tar.output);
    const bytes = await Deno.readFile(archive);
    const sha = "a".repeat(40);
    const requests: string[] = [];
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      requests.push(url);
      if (url === "https://api.github.com/repos/example/remote/commits/HEAD") {
        return Promise.resolve(
          Response.json({ sha, commit: { committer: { date: "2020-01-01T00:00:00Z" } } }),
        );
      }
      if (url === `https://codeload.github.com/example/remote/tar.gz/${sha}`) {
        return Promise.resolve(new Response(bytes));
      }
      throw new Error(`unexpected network request ${url}`);
    }) as typeof fetch;
    const source = await repositoryRecipe(join(base, "state"), "github.com/example/remote");
    assert(source.includes(sha), "recipe directory lost commit identity");
    const program = join(base, "program.js");
    await Deno.writeTextFile(`${program}.source`, source);
    assert(
      await recipeSource(program, "pak:self") ===
        `https://codeload.github.com/example/remote/tar.gz/${sha}`,
      "source did not follow the recipe commit",
    );
    await repositoryRecipe(join(base, "state"), "github.com/example/remote");
    assert(requests.length === 2, "cached loading rediscovered upstream");
  } finally {
    globalThis.fetch = originalFetch;
    if (previous === undefined) Deno.env.delete("PAKMAN_REPOSITORIES");
    else Deno.env.set("PAKMAN_REPOSITORIES", previous);
    await Deno.remove(base, { recursive: true });
  }
});

Deno.test("repository compilation cannot import Workman source outside its snapshot", async () => {
  const base = await Deno.makeTempDir();
  try {
    const tree = join(base, "tree");
    await Deno.mkdir(tree);
    await Deno.writeTextFile(join(base, "snapshot.json"), JSON.stringify({ root: tree }));
    await Deno.writeTextFile(join(base, "outside.wm"), "let secret = 1;\n");
    await Deno.writeTextFile(
      join(tree, "pak.wm"),
      'from "../outside.wm" import { secret };\nlet main = () => { print(secret) };\n',
    );
    let rejected = false;
    try {
      await compileProgram(join(tree, "pak.wm"), join(base, "compiled.js"));
    } catch (error) {
      rejected = String(error).includes("escapes its snapshot");
    }
    assert(rejected, "recipe compilation followed an external source import");
  } finally {
    await Deno.remove(base, { recursive: true });
  }
});
