import { assertEquals } from "@std/assert";
import { ValidationScheduler } from "../src/lsp/validation_scheduler.ts";

Deno.test("validation scheduler debounces to the latest idle generation", async () => {
  const scheduler = new ValidationScheduler(5);
  const runs: number[] = [];
  scheduler.schedule("main", ({ generation }) => {
    runs.push(generation);
  });
  scheduler.schedule("main", ({ generation }) => {
    runs.push(generation);
  });
  scheduler.schedule("main", ({ generation }) => {
    runs.push(generation);
  });

  await scheduler.drain();

  assertEquals(runs, [3]);
});

Deno.test("validation scheduler drops intermediate work behind an active generation", async () => {
  const scheduler = new ValidationScheduler(0);
  const runs: number[] = [];
  const freshness: boolean[] = [];
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => releaseFirst = resolve);
  let firstStarted!: () => void;
  const started = new Promise<void>((resolve) => firstStarted = resolve);

  scheduler.schedule("main", async (ticket) => {
    runs.push(ticket.generation);
    firstStarted();
    await firstBlocked;
    freshness.push(ticket.isCurrent());
  });
  await started;
  scheduler.schedule("main", ({ generation }) => {
    runs.push(generation);
  });
  scheduler.schedule("main", ({ generation }) => {
    runs.push(generation);
  });
  releaseFirst();
  await scheduler.drain();

  assertEquals(runs, [1, 3]);
  assertEquals(freshness, [false]);
});
