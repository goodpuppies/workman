import { dirname, resolve, sep } from "node:path";

/** Watch explicit project inputs; outputs should live outside these paths. */
export async function watchProject(
  paths: string[],
  run: (signal: AbortSignal) => Promise<number>,
  signal: AbortSignal,
): Promise<void> {
  const inputs = [...new Set(paths.map((path) => resolve(path)))];
  const roots = new Set<string>();
  for (const input of inputs) {
    // Watch the parent too, so atomic replacement and initially missing inputs work.
    let root = dirname(input);
    while (true) {
      try {
        if ((await Deno.stat(root)).isDirectory) break;
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) throw error;
      }
      const parent = dirname(root);
      if (parent === root) throw new Error(`no watchable parent for ${input}`);
      root = parent;
    }
    roots.add(root);
  }
  if (signal.aborted) return;
  const watcher = Deno.watchFs([...roots], { recursive: true });
  let revision = 0;
  let wake: (() => void) | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let watchError: unknown;
  const stop = () => {
    watcher.close();
    clearTimeout(timer);
    wake?.();
  };
  signal.addEventListener("abort", stop, { once: true });
  const watching = (async () => {
    try {
      for await (const event of watcher) {
        if (event.kind === "access") continue;
        if (
          !event.paths.some((path) =>
            inputs.some((input) => {
              const absolute = resolve(path);
              return absolute === input || absolute.startsWith(input + sep);
            })
          )
        ) continue;
        clearTimeout(timer);
        timer = setTimeout(() => {
          revision++;
          wake?.();
        }, 100);
      }
      if (!signal.aborted) throw new Error("project filesystem watcher closed unexpectedly");
    } catch (error) {
      if (!signal.aborted) watchError = error;
      wake?.();
    }
  })();
  try {
    while (!signal.aborted) {
      if (watchError) throw watchError;
      const started = revision;
      const changed = new Promise<void>((resolveChange) => {
        wake = resolveChange;
      });
      const controller = new AbortController();
      signal.addEventListener("abort", () => controller.abort(), {
        once: true,
        signal: controller.signal,
      });
      const running = run(controller.signal).catch((error) => {
        if (!controller.signal.aborted) {
          console.error(error instanceof Error ? error.message : error);
        }
        return 1;
      });
      try {
        const first = await Promise.race([
          running.then((code) => ({ code })),
          changed.then(() => undefined),
        ]);
        if (first && first.code !== 0 && !signal.aborted) {
          console.error(`project command exited with code ${first.code}; waiting for changes`);
        }
        if (!signal.aborted && revision === started && !watchError) await changed;
      } finally {
        controller.abort();
        await running;
        wake = undefined;
      }
      if (!signal.aborted && !watchError) console.log("wm project refresh");
    }
  } finally {
    signal.removeEventListener("abort", stop);
    watcher.close();
    clearTimeout(timer);
    await watching;
  }
}
