import { assertEquals } from "@std/assert";
import { runtime } from "../src/io.ts";
import { canonicalFilePath, fileUriToPath, pathToFileUri } from "../src/lsp/uri.ts";

Deno.test({
  name: "LSP decodes an encoded Windows drive before classifying the URI path",
  ignore: runtime.platform !== "win32",
  fn() {
    const path = fileUriToPath("file:///c%3A/GIT/gpuman/examples/window.wm");

    assertEquals(path, "c:\\GIT\\gpuman\\examples\\window.wm");
    assertEquals(canonicalFilePath(path), "C:\\GIT\\gpuman\\examples\\window.wm");
    assertEquals(pathToFileUri(path), "file:///C:/GIT/gpuman/examples/window.wm");
  },
});
