import { dirname } from "node:path";
import { compileWorkman } from "./compile.mjs";

/** Use with Bun.plugin() in a preload, or in Bun.build({ plugins: [...] }). */
export function workman(options = {}) {
  return {
    name: "workman",
    setup(build) {
      build.onLoad({ filter: /\.wm$/ }, async ({ path }) => {
        const result = await compileWorkman(path, options);
        return {
          contents: result.code,
          loader: "js",
          resolveDir: dirname(path),
        };
      });
    },
  };
}
