import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { CHeaderExtractError, extractCHeader } from "../src/ffi/c/extract.ts";
import { compileLibraryVirtual, compileVirtual } from "../src/compiler.ts";
import { dirname } from "node:path";
import { windowsGnuHeaderDirectories } from "../src/ffi/c/windows_headers.ts";

const extractorPath = process.env.WM_C_HEADER_EXTRACTOR;
const fixture = fileURLToPath(new URL("./fixtures/c_reflection.h", import.meta.url));

function nativeTest(name: string, fn: () => Promise<void>) {
  Deno.test({ name, fn });
}

nativeTest(
  "Aro reflects layouts, opaque types, enum constants, arrays and compound macros",
  async () => {
    const cacheDir = await Deno.makeTempDir();
    try {
      const result = await extractCHeader({
        header: fixture,
        symbols: [],
        extractorPath,
        cacheDir,
      });
      const aligned = result.types.find((t) => t.name === "Aligned");
      assertEquals(aligned?.kind, "struct");
      if (aligned?.kind !== "struct") throw new Error("missing Aligned struct");
      assertEquals([aligned.size, aligned.align], [32, 8]);
      assertEquals(aligned.fields.map((f) => f.offset), [0, 8, 16]);
      assertEquals(aligned.fields[2].type.length, 3);
      const opaque = result.types.find((t) => t.name === "Opaque");
      assertEquals(opaque?.kind === "struct" && opaque.opaque, true);
      const consume = result.fns.find((f) => f.name === "consume");
      assertEquals(consume?.params[0].const, true);
      const values = new Map(result.values.map((v) => [v.name, v.value]));
      assertEquals(values.get("MODE_ZERO"), 0);
      assertEquals(values.get("MODE_SEVEN"), 7);
      assertEquals(values.get("MODE_EIGHT"), 8);
      assertEquals(values.get("ANSWER"), 42);
      assertEquals(values.get("SCALE"), 1.5);
      assertEquals(values.get("COLOUR"), { tag: 9, value: 2.5, samples: [1, 2, 3] });
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  },
);

nativeTest("Aro invalidates reflection when a transitive include changes", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const header = `${dir}/main.h`;
    const dependency = `${dir}/dep.h`;
    await Deno.writeTextFile(header, '#include "dep.h"\n');
    await Deno.writeTextFile(dependency, "#define VALUE 1\n");
    const options = { header, symbols: ["VALUE"], extractorPath, cacheDir: `${dir}/cache` };
    assertEquals((await extractCHeader(options)).values[0].value, 1);
    await Deno.writeTextFile(dependency, "#define VALUE 20\n");
    assertEquals((await extractCHeader(options)).values[0].value, 20);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro preserves compiler C codec emission", async () => {
  const header = fileURLToPath(new URL("../examples/c_ffi/fixtures/vec3.h", import.meta.url));
  const js = await compileLibraryVirtual(
    "/test/main.wm",
    new Map([[
      "/test/main.wm",
      `from c.header(${JSON.stringify(header)}) import type { Vector3 };
     let main = () => { let v = newVector3(1, 2, 3); print(getVector3_x(v)) };`,
    ]]),
  );
  assertStringIncludes(js, '"name":"Vector3"');
  assertStringIncludes(js, "__wm_c_setup_codec");
});

nativeTest("Aro reports invalid C headers", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const header = `${dir}/broken.h`;
    await Deno.writeTextFile(header, "typedef struct Broken { int ; nope } Broken;");
    await assertRejects(
      () => extractCHeader({ header, symbols: [], extractorPath, cacheDir: dir }),
      CHeaderExtractError,
      "Aro C header reflection failed",
    );
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro rejects bitfields instead of emitting unsafe layouts", async () => {
  const dir = await Deno.makeTempDir();
  try {
    for (
      const [source, diagnostic] of [
        ["typedef struct Bits { unsigned int flag:1; } Bits;", "BitFieldsNotSupported"],
      ]
    ) {
      const header = `${dir}/unsupported.h`;
      await Deno.writeTextFile(header, source);
      await assertRejects(
        () => extractCHeader({ header, symbols: [], extractorPath, cacheDir: dir }),
        CHeaderExtractError,
        diagnostic,
      );
    }
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

nativeTest("Aro resolves bare system headers without compiling a Zig program", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const result = await extractCHeader({
      header: "stdio.h",
      symbols: ["puts"],
      extractorPath,
      cacheDir: dir,
    });
    assertEquals(result.fns[0].name, "puts");
    assertEquals(result.fns[0].params[0].kind, "pointer");
    assertEquals(result.fns[0].params[0].const, true);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "Aro supports an explicit MSVC target for Windows headers",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const cacheDir = await Deno.makeTempDir();
    try {
      const header = `${cacheDir}/msvc.h`;
      await Deno.writeTextFile(
        header,
        `
        #ifndef _MSC_VER
        #error Expected the Microsoft C dialect
        #endif
        #if !defined(_M_X64) && !defined(_M_ARM64)
        #error Expected a native Windows architecture
        #endif
        unsigned __int64 native_handle(unsigned __int64 handle);
      `,
      );
      const result = await extractCHeader({
        header,
        symbols: ["native_handle"],
        target: `${Deno.build.arch}-windows-msvc`,
        extractorPath,
        cacheDir,
      });
      assertEquals(result.fns[0].name, "native_handle");
      assertEquals(result.fns[0].return?.bits, 64);
      assertEquals(result.fns[0].params[0].bits, 64);
    } finally {
      await Deno.remove(cacheDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "native Windows reflects Winsock using MinGW headers without running Zig",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const directories = await windowsGnuHeaderDirectories();
    const cacheDir = await Deno.makeTempDir();
    const previous = new Map(
      ["WM_C_HEADER_ZIG_LIB_DIR", "WM_ZIG_PATH", "INCLUDE"].map((
        name,
      ) => [name, Deno.env.get(name)]),
    );
    try {
      Deno.env.set("WM_C_HEADER_ZIG_LIB_DIR", dirname(directories[1]));
      Deno.env.set("WM_ZIG_PATH", `${cacheDir}/missing-zig`);
      // A Developer Prompt's Microsoft include path must not contaminate MinGW.
      await Deno.mkdir(`${cacheDir}/msvc`);
      await Deno.writeTextFile(`${cacheDir}/msvc/winsock2.h`, "#error Wrong header environment\n");
      Deno.env.set("INCLUDE", `${cacheDir}/msvc`);
      const result = await extractCHeader({
        header: "winsock2.h",
        symbols: [
          "socket",
          "bind",
          "listen",
          "accept",
          "recv",
          "send",
          "closesocket",
          "WSAStartup",
          "AF_INET",
          "SOCK_STREAM",
        ],
        extractorPath,
        cacheDir,
      });
      assertEquals(result.fns.map((fn) => fn.name).sort(), [
        "WSAStartup",
        "accept",
        "bind",
        "closesocket",
        "listen",
        "recv",
        "send",
        "socket",
      ]);
      const socket = result.fns.find((fn) => fn.name === "socket")!;
      assertEquals(socket.return?.kind, "int");
      assertEquals(socket.return?.bits, 64);
      assertEquals(socket.return?.signed, false);
      assertEquals(result.values.find((value) => value.name === "AF_INET")?.value, 2);
      assertEquals(result.values.find((value) => value.name === "SOCK_STREAM")?.value, 1);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) Deno.env.delete(name);
        else Deno.env.set(name, value);
      }
      await Deno.remove(cacheDir, { recursive: true });
    }
  },
});

Deno.test({
  name: "reflected Winsock calls run against the Windows system DLL",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const js = await compileVirtual(
        "/test/winsock-header.wm",
        new Map([[
          "/test/winsock-header.wm",
          `
          from c.header("winsock2.h", lib: "ws2_32") import unsafe { htons, AF_INET, SOCK_STREAM };
          let main = () => { print(htons(Word16.fromNumber(8080))); print(AF_INET); print(SOCK_STREAM); };
        `,
        ]]),
      );
      const path = `${dir}/winsock.mjs`;
      await Deno.writeTextFile(path, js);
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-config", path],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(new TextDecoder().decode(result.stdout).trim().split(/\r?\n/), [
        "36895",
        "2",
        "1",
      ]);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});

nativeTest("reflected stdio compiles and runs against the host C runtime", async () => {
  const dir = await Deno.makeTempDir();
  try {
    const js = await compileVirtual(
      "/test/stdio.wm",
      new Map([[
        "/test/stdio.wm",
        `
        from "host/c/pointer.wm" import * as Pointer;
        from c.header("stdio.h") import unsafe { puts };
        let main = () => { puts(Some(Pointer.fromString("workman stdio smoke test"))); };
      `,
      ]]),
    );
    const path = `${dir}/stdio.mjs`;
    await Deno.writeTextFile(path, js);
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["run", "-A", "--no-config", path],
      stdout: "piped",
      stderr: "piped",
    }).output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
    assertStringIncludes(new TextDecoder().decode(result.stdout), "workman stdio smoke test");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test({
  name: "bare Windows C library names load the corresponding DLL",
  ignore: Deno.build.os !== "windows",
  async fn() {
    const dir = await Deno.makeTempDir();
    try {
      const js = await compileVirtual(
        "/test/winsock.wm",
        new Map([[
          "/test/winsock.wm",
          `
          from c.lib("ws2_32") import unsafe { htons: Word16.Word -> Word16.Word };
          let main = () => { print(htons(Word16.fromNumber(0))); };
        `,
        ]]),
      );
      const path = `${dir}/winsock.mjs`;
      await Deno.writeTextFile(path, js);
      const result = await new Deno.Command(Deno.execPath(), {
        args: ["run", "-A", "--no-config", path],
        stdout: "piped",
        stderr: "piped",
      }).output();
      assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
      assertEquals(new TextDecoder().decode(result.stdout).trim(), "0");
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
