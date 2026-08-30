import { renderExplainDiagnostic, renderHeader, renderTraceDiagnostic } from "./rendering.ts";
import type { AuthoredDiagnosticProfile } from "./profile.ts";

export const missingEntrypointProfile: AuthoredDiagnosticProfile = {
  id: "missing-entrypoint",
  codes: ["run.missing-entrypoint"],
  rules: ["Run.EntryPoint"],
  render(diagnostic, filePath, source, options) {
    if (options.mode === "trace") return renderTraceDiagnostic(diagnostic, filePath, source);
    if (options.mode === "explain") return renderExplainDiagnostic(diagnostic, filePath, source);

    return `${
      [
        renderHeader(diagnostic, filePath),
        "",
        "This file cannot be run because it has no `main` function.",
        "",
        "`wm run` starts by calling `main`. Add a top-level entrypoint, for example:",
        "",
        "    let main = () => {};",
      ].join("\n")
    }\n`;
  },
};
