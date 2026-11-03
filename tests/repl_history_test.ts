import { assertEquals, assertThrows } from "@std/assert";
import { join } from "node:path";
import { readReplHistory, recordReplHistory, replHistoryLimit } from "../src/repl_history.ts";

Deno.test("REPL history survives reopening and keeps submitted errors", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = join(dir, "state", "repl-history.json");
    assertEquals(readReplHistory(file), []);
    recordReplHistory(file, "let answer = 42;");
    recordReplHistory(file, "let bad = ;");
    recordReplHistory(file, 'Panic "boom";');
    assertEquals(readReplHistory(file), ['Panic "boom";', "let bad = ;", "let answer = 42;"]);
    // A later session reads existing history before adding its own input.
    recordReplHistory(file, "answer;");
    assertEquals(readReplHistory(file), [
      "answer;",
      'Panic "boom";',
      "let bad = ;",
      "let answer = 42;",
    ]);
    if (Deno.build.os !== "windows") assertEquals(Deno.statSync(file).mode! & 0o777, 0o600);
    assertEquals([...Deno.readDirSync(join(dir, "state"))].map((entry) => entry.name), [
      "repl-history.json",
    ]);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("REPL history ignores blank input and consecutive duplicates and caps saved lines", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = join(dir, "history.json");
    const old = Array.from({ length: replHistoryLimit + 5 }, (_, index) => `${index};`);
    Deno.writeTextFileSync(file, JSON.stringify(old));
    assertEquals(readReplHistory(file).length, replHistoryLimit);
    recordReplHistory(file, "  ");
    recordReplHistory(file, "0;");
    assertEquals(readReplHistory(file), old.slice(0, replHistoryLimit));
    recordReplHistory(file, "new;");
    assertEquals(readReplHistory(file), ["new;", ...old.slice(0, replHistoryLimit - 1)]);
    assertEquals(JSON.parse(Deno.readTextFileSync(file)).length, replHistoryLimit);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("REPL history preserves a malformed file instead of overwriting it", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const file = join(dir, "history.json");
    for (const source of ["broken json", "{}", '["valid", 42]']) {
      Deno.writeTextFileSync(file, source);
      assertThrows(() => readReplHistory(file));
      assertThrows(() => recordReplHistory(file, "1;"));
      assertEquals(Deno.readTextFileSync(file), source);
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
