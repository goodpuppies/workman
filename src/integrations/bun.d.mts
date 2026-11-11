export interface WorkmanOptions {
  denoPath?: string;
}
/** Bun runtime/bundler plugin; register at startup before importing WM. */
export function workman(options?: WorkmanOptions): {
  name: string;
  setup(build: {
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => Promise<{
        contents: string;
        loader: "js";
        resolveDir: string;
      }>,
    ): void;
  }): void;
};
