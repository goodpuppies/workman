#!/usr/bin/env node
const { spawn } = require("node:child_process");
try {
  const binary = require("./resolve.cjs").resolveBinary();
  const child = spawn(binary, process.argv.slice(2), { stdio: "inherit" });
  for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
  child.on("error", (error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
  child.on("exit", (code, signal) => {
    process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
  });
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
