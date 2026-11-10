import { assertEquals } from "@std/assert";
import { MarkedStream } from "../src/repl.ts";
import { BASIC_STYLES, highlightReplOutput, paintRange } from "../src/repl_highlight.ts";

Deno.test("REPL result reports are colored separately from streamed program output", async () => {
  const marker = "\u0000wm-repl-done:test:";
  const report = (text: string) => `${marker}report:${JSON.stringify(text)}\n`;
  const text = "Ellie\n" + report('user = { name = "Ellie" } : User') +
    "it = ordinary program output\n" + report("it = void : Void!") + `${marker}0\n`;
  const encoder = new TextEncoder();
  const bytes = encoder.encode(text);
  // Deliberately split UTF-8 and protocol markers across reads.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3));
      controller.close();
    },
  });
  let output = "";
  const decoder = new TextDecoder();
  const format = (text: string) =>
    paintRange(text, 0, text.length, highlightReplOutput(text), BASIC_STYLES);
  const marked = new MarkedStream(stream, (chunk) => {
    output += decoder.decode(chunk);
    return Promise.resolve();
  }, format);
  assertEquals(await marked.until(marker), 0);
  await marked.drain();
  assertEquals(
    output,
    "Ellie\n" + format('user = { name = "Ellie" } : User') +
      "\nit = ordinary program output\n" + format("it = void : Void!") + "\n",
  );
});

Deno.test("REPL output reports remain plain when highlighting is disabled", async () => {
  const marker = "\u0000wm-repl-done:plain:";
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        encoder.encode(`${marker}report:${JSON.stringify("it = void : Void!")}\n${marker}0\n`),
      );
      controller.close();
    },
  });
  let output = "";
  const marked = new MarkedStream(stream, async (chunk) => {
    output += new TextDecoder().decode(chunk);
  });
  assertEquals(await marked.until(marker), 0);
  await marked.drain();
  assertEquals(output, "it = void : Void!\n");
});
