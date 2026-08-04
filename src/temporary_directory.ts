export interface TemporaryDirectory {
  readonly path: string;
  cleanup(): Promise<void>;
}

/**
 * Create a directory whose cleanup capability is permanently bound to the path
 * returned by Deno. Callers never pass a path to recursive deletion.
 */
export async function createTemporaryDirectory(
  options: Deno.MakeTempOptions = {},
): Promise<TemporaryDirectory> {
  const path = await Deno.makeTempDir(options);
  let cleaned = false;
  return Object.freeze({
    path,
    async cleanup(): Promise<void> {
      if (cleaned) return;
      try {
        await Deno.remove(path, { recursive: true });
        cleaned = true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          cleaned = true;
          return;
        }
        throw error;
      }
    },
  });
}
