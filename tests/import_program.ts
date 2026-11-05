/**
 * Run a compiled program inside the test process. A whole number returned from `main` sets the
 * process's exit code, which here is the test runner's, so it's restored afterwards.
 */
export async function importProgram(url: string) {
  const before = Deno.exitCode;
  try {
    return await import(url);
  } finally {
    Deno.exitCode = before;
  }
}
