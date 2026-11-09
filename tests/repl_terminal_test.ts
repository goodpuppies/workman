import { assertEquals } from "@std/assert";
import { holdTerminalInput } from "../src/repl_terminal.ts";
import { TerminalEditor } from "../src/repl_editor.ts";

Deno.test({
  name:
    "Windows cbreak keeps VT input and signals, disables echo and buffering, and restores modes",
  ignore: Deno.build.os !== "windows" || !Deno.stdin.isTerminal(),
  fn() {
    const kernel = Deno.dlopen("kernel32.dll", {
      GetStdHandle: { parameters: ["u32"], result: "pointer" },
      GetConsoleMode: { parameters: ["pointer", "buffer"], result: "i32" },
    });
    const input = kernel.symbols.GetStdHandle(0xfffffff6);
    const mode = new Uint32Array(1);
    const readMode = () => {
      assertEquals(kernel.symbols.GetConsoleMode(input, mode), 1);
      return mode[0];
    };
    const original = readMode();
    try {
      holdTerminalInput();
      assertEquals(readMode() & 0x207, 0x201); // VT + processed; no echo or line input.
      Deno.stdin.setRaw(true);
      assertEquals(readMode() & 0x207, 0x200); // Editor receives Ctrl-C as a key.
      holdTerminalInput();
      assertEquals(readMode() & 0x207, 0x201);
    } finally {
      Deno.stdin.setRaw(false);
      try {
        assertEquals(readMode(), original);
      } finally {
        kernel.close();
      }
    }
  },
});

Deno.test({
  name: "Windows console Shift+Enter submits an unterminated editor expression",
  ignore: Deno.build.os !== "windows" || !Deno.stdin.isTerminal() || !Deno.stdout.isTerminal(),
  async fn() {
    const kernel = Deno.dlopen("kernel32.dll", {
      GetStdHandle: { parameters: ["u32"], result: "pointer" },
      WriteConsoleInputW: { parameters: ["pointer", "buffer", "u32", "buffer"], result: "i32" },
    });
    // Native INPUT_RECORDs: five printable characters, then Shift+Enter.
    const text = "1 + 2\r";
    const records = new Uint8Array(text.length * 20);
    const view = new DataView(records.buffer);
    for (let index = 0; index < text.length; index++) {
      const offset = index * 20;
      view.setUint16(offset, 1, true); // KEY_EVENT.
      view.setInt32(offset + 4, 1, true); // Key down.
      view.setUint16(offset + 8, 1, true); // Repeat count.
      view.setUint16(offset + 10, index === text.length - 1 ? 13 : 0, true);
      view.setUint16(offset + 14, text.charCodeAt(index), true);
      view.setUint32(offset + 16, index === text.length - 1 ? 0x10 : 0, true);
    }
    const editor = new TerminalEditor([]);
    try {
      const result = editor.read(); // Enter raw mode and start waiting for input.
      const written = new Uint32Array(1);
      assertEquals(
        kernel.symbols.WriteConsoleInputW(
          kernel.symbols.GetStdHandle(0xfffffff6),
          records,
          text.length,
          written,
        ),
        1,
      );
      assertEquals(written[0], text.length);
      assertEquals(await result, { kind: "submit", text: "1 + 2;" });
    } finally {
      editor.release();
      kernel.close();
    }
  },
});
