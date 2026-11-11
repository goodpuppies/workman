export interface WorkmanOptions {
  denoPath?: string;
}
/** Vite plugin. Compiles WM library entries and watches their transitive WM dependencies. */
export function workman(options?: WorkmanOptions): {
  name: string;
  enforce: "pre";
  load(
    this: { addWatchFile(path: string): void },
    id: string,
  ): Promise<{ code: string; map: null } | null>;
};
