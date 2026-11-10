import { assertEquals } from "@std/assert";
import { join } from "node:path";
import { watchProject } from "../src/project_watch.ts";

Deno.test("project watch notices newly created nested inputs and waits for active builds to stop", async () => {
  const root = await Deno.makeTempDir();
  const controller = new AbortController();
  const order: string[] = [];
  let firstReady!: () => void;
  let secondReady!: () => void;
  const first = new Promise<void>((resolve) => {
    firstReady = resolve;
  });
  const second = new Promise<void>((resolve) => {
    secondReady = resolve;
  });
  let iteration = 0;
  const watching = watchProject([join(root, "src")], async (signal) => {
    const current = ++iteration;
    order.push(`start:${current}`);
    if (current === 1) firstReady();
    else secondReady();
    await new Promise<void>((resolve) => {
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
    // A restart must await asynchronous cleanup before the next build starts.
    await new Promise((resolve) => setTimeout(resolve, 10));
    order.push(`stop:${current}`);
    return 0;
  }, controller.signal);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await first;
    await Deno.mkdir(join(root, "src", "nested"), { recursive: true });
    await Deno.writeTextFile(join(root, "src", "nested", "app.wm"), "created");
    await Promise.race([
      second,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("new input did not restart the build")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    await watching;
    await Deno.remove(root, { recursive: true });
  }
  assertEquals(order, ["start:1", "stop:1", "start:2", "stop:2"]);
});
