import { assertStringIncludes } from "@std/assert";

const cli = new URL("../src/main.ts", import.meta.url).pathname;

Deno.test("watch survives parse errors and refreshes its transitive module graph", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  const middle = `${directory}/middle.wm`;
  const leaf = `${directory}/leaf.wm`;
  const replacement = `${directory}/replacement.wm`;
  await Deno.writeTextFile(leaf, 'let message = "first";');
  await Deno.writeTextFile(replacement, 'let message = "third";');
  await Deno.writeTextFile(
    middle,
    'from "./leaf.wm" import { message }; let forwarded = message;',
  );
  await Deno.writeTextFile(
    input,
    'from "./middle.wm" import { forwarded }; let main = () => { print(forwarded) };',
  );

  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "watch", input],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const reader = child.stdout.getReader();
  const errorReader = child.stderr.getReader();
  const decoder = new TextDecoder();
  const errorDecoder = new TextDecoder();
  let output = "";
  let errors = "";
  try {
    output = await readUntil(reader, decoder, output, "first\n");
    await Deno.writeTextFile(leaf, "let message = );");
    errors = await readUntil(errorReader, errorDecoder, errors, "parse.syntax-error");
    await Deno.writeTextFile(leaf, 'let message = "second";');
    output = await readUntil(reader, decoder, output, "second\n");
    assertStringIncludes(output, "wm watch refresh");
    await Deno.writeTextFile(
      middle,
      'from "./replacement.wm" import { message }; let forwarded = message;',
    );
    output = await readUntil(reader, decoder, output, "third\n");
    await Deno.writeTextFile(replacement, 'let message = "fourth";');
    output = await readUntil(reader, decoder, output, "fourth\n");
    assertStringIncludes(output, "first\n");
    assertStringIncludes(output, "second\n");
    assertStringIncludes(output, "third\n");
    assertStringIncludes(output, "fourth\n");
    assertStringIncludes(errors, leaf);
  } finally {
    reader.releaseLock();
    errorReader.releaseLock();
    try {
      child.kill();
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await child.status;
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("watch executes until reaching a typed hole and resumes after replacement", async () => {
  const directory = await Deno.makeTempDir();
  const input = `${directory}/main.wm`;
  await Deno.writeTextFile(
    input,
    'let main = () => { print("before"); ?; print("after") };',
  );

  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", cli, "watch", input],
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const reader = child.stdout.getReader();
  const errorReader = child.stderr.getReader();
  const decoder = new TextDecoder();
  const errorDecoder = new TextDecoder();
  try {
    const outputBeforeHole = await readUntil(reader, decoder, "", "before\n");
    const errors = await readUntil(errorReader, errorDecoder, "", "typed hole");
    assertStringIncludes(outputBeforeHole, "before\n");
    if (outputBeforeHole.includes("after\n")) {
      throw new Error("watch executed code after a reached typed hole");
    }
    assertStringIncludes(errors, "typed hole");
    if (errors.includes("Uncaught") || errors.includes("main.mjs")) {
      throw new Error("watch exposed the generated JavaScript typed-hole stack");
    }
    await Deno.writeTextFile(input, 'let main = () => { print("fixed") };');
    const output = await readUntil(reader, decoder, outputBeforeHole, "fixed\n");
    assertStringIncludes(output, "fixed\n");
  } finally {
    reader.releaseLock();
    errorReader.releaseLock();
    try {
      child.kill();
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    await child.status;
    await Deno.remove(directory, { recursive: true });
  }
});

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  decoder: TextDecoder,
  initial: string,
  expected: string,
): Promise<string> {
  let output = initial;
  const deadline = Date.now() + 15_000;
  while (!output.includes(expected)) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new Error(`timed out waiting for ${JSON.stringify(expected)}`);
    const result = await readWithTimeout(reader, remaining, expected);
    if (result.done) throw new Error(`watch stdout ended before ${JSON.stringify(expected)}`);
    output += decoder.decode(result.value, { stream: true });
  }
  return output;
}

async function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeout: number,
  expected: string,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timed out waiting for ${JSON.stringify(expected)}`)),
          timeout,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
