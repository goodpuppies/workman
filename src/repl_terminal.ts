/** Quiet, unbuffered input between editor reads, with Ctrl-C still delivered as a signal. */
export function holdTerminalInput(): void {
  if (Deno.build.os !== "windows") {
    Deno.stdin.setRaw(true, { cbreak: true });
    return;
  }

  // Deno rejects cbreak on Windows. Its raw mode already disables line input and
  // echo and enables VT input; add back processed input to preserve Ctrl-C signals.
  const kernel = Deno.dlopen("kernel32.dll", {
    GetStdHandle: { parameters: ["u32"], result: "pointer" },
    GetConsoleMode: { parameters: ["pointer", "buffer"], result: "i32" },
    SetConsoleMode: { parameters: ["pointer", "u32"], result: "i32" },
    GetLastError: { parameters: [], result: "u32" },
  });
  try {
    Deno.stdin.setRaw(true);
    const input = kernel.symbols.GetStdHandle(0xfffffff6); // STD_INPUT_HANDLE (-10).
    const mode = new Uint32Array(1);
    if (
      !kernel.symbols.GetConsoleMode(input, mode) ||
      !kernel.symbols.SetConsoleMode(input, mode[0] | 0x0001)
    ) { // ENABLE_PROCESSED_INPUT.
      throw new Error(
        `cannot enable Windows cbreak input (error ${kernel.symbols.GetLastError()})`,
      );
    }
  } catch (error) {
    Deno.stdin.setRaw(false);
    throw error;
  } finally {
    kernel.close();
  }
}
