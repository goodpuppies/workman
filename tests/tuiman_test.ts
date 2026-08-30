import { assertEquals, assertStringIncludes } from "@std/assert";
import { renderDocument } from "../src/generated/tuiman.js";

Deno.test("tuiman renders semantic diagnostic documents without guessing from text", () => {
  const document = {
    lines: [
      { spans: [{ text: "  - Void", role: "type" }] },
      { spans: [{ text: "- use wm err main.wm", role: "hint" }] },
      { spans: [{ text: "Warning:", role: "warning" }] },
    ],
  };

  assertEquals(renderDocument([document, false]), "  - Void\n- use wm err main.wm\nWarning:");
  const colored = renderDocument([document, true]);
  assertStringIncludes(colored, "\x1b[38;2;57;255;20m  - Void");
  assertStringIncludes(colored, "\x1b[2m- use wm err main.wm");
  assertStringIncludes(colored, "\x1b[38;2;255;211;67m\x1b[1mWarning:");
});
