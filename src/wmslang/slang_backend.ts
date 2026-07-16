import createSlangModule from "./vendor/slang-wasm.js";
import type { MainModule } from "./vendor/slang-wasm.d.ts";

const SLANG_RELEASE_VERSION = "2026.13.1";
const SLANG_RELEASE_URL =
  `https://github.com/shader-slang/slang/releases/download/v${SLANG_RELEASE_VERSION}/slang-${SLANG_RELEASE_VERSION}-wasm.zip`;
const SLANG_RELEASE_SHA256 = "ff5c1a83ddfaf9a86cfbe81580ca9694e0a3ded4158722549a24a57cf6f03255";
const SLANG_WASM_SHA256 = "90661b3cf23fdf3e3f6daa07b14fd5e4f6f300ad703aa7b23ddc4579279a2fb5";
const SLANG_WASM_SIZE = 22_716_023;
const SLANG_CACHE_NAME = "goodpuppies-workman-wmslang";

export const WMSLANG_VERTEX_ENTRY = "wm_vertex" as const;
export const WMSLANG_FRAGMENT_ENTRY = "wm_fragment" as const;

// Values from Slang's SlangStage enum. The pinned runtime test verifies both
// against reflection, so a binding/version mismatch fails at the backend boundary.
const SLANG_STAGE_VERTEX = 1;
const SLANG_STAGE_FRAGMENT = 5;

export type WmslangBackendArtifact = {
  wgsl: string;
  vertexEntry: typeof WMSLANG_VERTEX_ENTRY;
  fragmentEntry: typeof WMSLANG_FRAGMENT_ENTRY;
  slangVersion: string;
};

export class WmslangBackendError extends Error {
  constructor(
    message: string,
    readonly slangSource: string,
    readonly backendDiagnostic: string,
  ) {
    super(message);
    this.name = "WmslangBackendError";
  }
}

export class WmslangSlangBackend {
  private constructor(private readonly slang: MainModule) {}

  static async load(wasmUrl?: URL) {
    const wasmBinary = wasmUrl ? await Deno.readFile(wasmUrl) : await downloadPinnedSlangWasm();
    return new WmslangSlangBackend(
      await createSlangModule({ wasmBinary }) as MainModule,
    );
  }

  get version(): string {
    return this.slang.getVersionString();
  }

  compile(slangSource: string): WmslangBackendArtifact {
    if (slangSource.length === 0) {
      throw new WmslangBackendError(
        "cannot compile an empty wmslang module",
        slangSource,
        "generated Slang source is empty",
      );
    }

    const globalSession = this.slang.createGlobalSession();
    if (!globalSession) throw this.compilerError("create global session", slangSource);
    const wgslTarget = this.slang.getCompileTargets().find(
      (target: { name: string; value: number }) => target.name === "WGSL",
    )?.value;
    if (wgslTarget === undefined) {
      globalSession.delete();
      throw new WmslangBackendError(
        "the bundled Slang compiler has no WGSL target",
        slangSource,
        `Slang ${this.version} did not report WGSL in getCompileTargets()`,
      );
    }

    const session = globalSession.createSession(wgslTarget);
    if (!session) {
      globalSession.delete();
      throw this.compilerError("create WGSL session", slangSource);
    }

    try {
      const module = session.loadModuleFromSource(
        slangSource,
        "wmslang_v1",
        "/wmslang-v1.slang",
      );
      if (!module) throw this.compilerError("load generated module", slangSource);
      const vertex = module.findAndCheckEntryPoint(WMSLANG_VERTEX_ENTRY, SLANG_STAGE_VERTEX);
      if (!vertex) throw this.compilerError("check generated vertex entry", slangSource);
      const fragment = module.findAndCheckEntryPoint(
        WMSLANG_FRAGMENT_ENTRY,
        SLANG_STAGE_FRAGMENT,
      );
      if (!fragment) throw this.compilerError("check generated fragment entry", slangSource);

      const composite = session.createCompositeComponentType([module, vertex, fragment]);
      if (!composite) throw this.compilerError("create generated program", slangSource);
      const linked = composite.link();
      if (!linked) throw this.compilerError("link generated program", slangSource);
      const wgsl = linked.getTargetCode(0);
      if (!wgsl) throw this.compilerError("emit whole-program WGSL", slangSource);
      this.validateReflection(linked.getLayout(0)?.toJsonObject(), slangSource);
      if (!wgsl.includes(`fn ${WMSLANG_VERTEX_ENTRY}`) || !wgsl.includes("@vertex")) {
        throw new WmslangBackendError(
          "Slang emitted WGSL without the fixed vertex entry",
          slangSource,
          "whole-program WGSL is missing @vertex wm_vertex",
        );
      }
      if (!wgsl.includes(`fn ${WMSLANG_FRAGMENT_ENTRY}`) || !wgsl.includes("@fragment")) {
        throw new WmslangBackendError(
          "Slang emitted WGSL without the fixed fragment entry",
          slangSource,
          "whole-program WGSL is missing @fragment wm_fragment",
        );
      }
      return {
        wgsl,
        vertexEntry: WMSLANG_VERTEX_ENTRY,
        fragmentEntry: WMSLANG_FRAGMENT_ENTRY,
        slangVersion: this.version,
      };
    } finally {
      session.delete();
      globalSession.delete();
    }
  }

  private validateReflection(value: unknown, slangSource: string): void {
    const reflection = value as
      | {
        parameters?: unknown[];
        entryPoints?: Array<{ name?: unknown; stage?: unknown }>;
      }
      | null
      | undefined;
    const entries = reflection?.entryPoints;
    if (!Array.isArray(entries)) {
      throw new WmslangBackendError(
        "Slang returned no entry-point reflection",
        slangSource,
        "whole-program layout has no entryPoints array",
      );
    }
    const actual = entries.map(({ name, stage }) => ({ name, stage }));
    const expected = [
      { name: WMSLANG_VERTEX_ENTRY, stage: "vertex" },
      { name: WMSLANG_FRAGMENT_ENTRY, stage: "fragment" },
    ];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new WmslangBackendError(
        "Slang reflection disagrees with the fixed visual-v1 entries",
        slangSource,
        `expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
      );
    }
    if (!Array.isArray(reflection?.parameters) || reflection.parameters.length !== 0) {
      throw new WmslangBackendError(
        "static visual-v1 generated an unexpected shader resource",
        slangSource,
        `expected no global parameters, received ${JSON.stringify(reflection?.parameters)}`,
      );
    }
  }

  private compilerError(action: string, slangSource: string): WmslangBackendError {
    const error = this.slang.getLastError();
    const diagnostic = String(error?.message ?? error ?? "unknown Slang compiler error");
    return new WmslangBackendError(
      `Slang could not ${action}`,
      slangSource,
      diagnostic,
    );
  }
}

let defaultBackend: Promise<WmslangSlangBackend> | undefined;

export function loadDefaultWmslangSlangBackend(): Promise<WmslangSlangBackend> {
  return defaultBackend ??= WmslangSlangBackend.load();
}

async function downloadPinnedSlangWasm(): Promise<Uint8Array> {
  const archive = await loadSlangReleaseArchive();
  const wasm = await extractFirstZipEntry(archive, "slang-wasm.wasm");
  if (wasm.byteLength !== SLANG_WASM_SIZE) {
    throw new Error(
      `Slang WASM size mismatch: expected ${SLANG_WASM_SIZE}, received ${wasm.byteLength}`,
    );
  }
  await requireSha256("Slang WASM", wasm, SLANG_WASM_SHA256);
  return wasm;
}

async function loadSlangReleaseArchive(): Promise<Uint8Array> {
  const cache = await caches.open(SLANG_CACHE_NAME);
  const cached = await cache.match(SLANG_RELEASE_URL);
  if (cached) {
    const archive = new Uint8Array(await cached.arrayBuffer());
    try {
      await requireSha256("cached Slang release archive", archive, SLANG_RELEASE_SHA256);
      return archive;
    } catch {
      await cache.delete(SLANG_RELEASE_URL);
    }
  }

  const response = await fetch(SLANG_RELEASE_URL);
  if (!response.ok) {
    throw new Error(
      `cannot download Slang ${SLANG_RELEASE_VERSION}: ${response.status} ${response.statusText}`,
    );
  }
  const archive = new Uint8Array(await response.arrayBuffer());
  await requireSha256("Slang release archive", archive, SLANG_RELEASE_SHA256);
  await cache.put(SLANG_RELEASE_URL, new Response(archive));
  return archive;
}

async function extractFirstZipEntry(
  archive: Uint8Array,
  expectedName: string,
): Promise<Uint8Array> {
  const header = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  if (header.byteLength < 30 || header.getUint32(0, true) !== 0x04034b50) {
    throw new Error("Slang release is not a supported ZIP archive");
  }
  const compressionMethod = header.getUint16(8, true);
  if (compressionMethod !== 8) {
    throw new Error(`Slang ZIP entry uses unsupported compression method ${compressionMethod}`);
  }
  const compressedSize = header.getUint32(18, true);
  const uncompressedSize = header.getUint32(22, true);
  const nameLength = header.getUint16(26, true);
  const extraLength = header.getUint16(28, true);
  const nameStart = 30;
  const dataStart = nameStart + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > archive.byteLength) throw new Error("Slang ZIP entry is truncated");
  const name = new TextDecoder().decode(archive.subarray(nameStart, nameStart + nameLength));
  if (name !== expectedName) {
    throw new Error(`Slang ZIP begins with ${JSON.stringify(name)}, expected ${expectedName}`);
  }
  const compressed = archive.slice(dataStart, dataEnd);
  const stream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("deflate-raw"),
  );
  const result = new Uint8Array(await new Response(stream).arrayBuffer());
  if (result.byteLength !== uncompressedSize) {
    throw new Error(
      `Slang ZIP entry size mismatch: expected ${uncompressedSize}, received ${result.byteLength}`,
    );
  }
  return result;
}

async function requireSha256(label: string, bytes: Uint8Array, expected: string): Promise<void> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  const actual = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  if (actual !== expected) {
    throw new Error(`${label} integrity mismatch: expected ${expected}, received ${actual}`);
  }
}
