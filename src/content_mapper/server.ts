import process from "node:process";
import { decodeMessages, encodeMessage, type RpcMessage } from "../lsp/rpc.ts";
import { projectWorkman } from "./projection.ts";
import { projectConfiguration } from "./project.ts";

class RpcError extends Error {
  constructor(readonly code: number, message: string) {
    super(message);
  }
}

/** State belongs to one mapper process; project handles never leak across instances. */
export class ContentMapper {
  private projects = new Set<string>();

  async request(method: string, input: unknown): Promise<unknown> {
    const params = input as Record<string, unknown> | undefined;
    switch (method) {
      case "initialize": {
        if (
          !Array.isArray(params?.positionEncodings) || !params.positionEncodings.includes("utf-16")
        ) {
          throw new RpcError(-32602, "Workman's mapper requires UTF-16 position encoding");
        }
        return {
          ...(params.protocolVersion === undefined
            ? {}
            : { protocolVersion: params.protocolVersion }),
          positionEncoding: "utf-16",
          diagnosticSource: "workman",
        };
      }
      case "openProject": {
        const handle = projectHandle(params);
        if (this.projects.has(handle)) throw new RpcError(-32602, "Project is already open");
        const options = params?.options;
        if (
          options !== undefined &&
          (options === null || typeof options !== "object" || Array.isArray(options))
        ) {
          throw new RpcError(-32602, "options must be an object");
        }
        const entryPoints = (options as { entryPoints?: unknown })?.entryPoints ?? [];
        if (
          !Array.isArray(entryPoints) || !entryPoints.every((entry) => typeof entry === "string")
        ) {
          throw new RpcError(-32602, "entryPoints must be an array of WM module paths");
        }
        const configuration = await projectConfiguration(
          typeof params?.configFileName === "string" ? params.configFileName : "",
          entryPoints,
        );
        this.projects.add(handle);
        return {
          ...configuration,
          optionDiagnostics: Object.keys(options ?? {}).filter((name) => name !== "entryPoints")
            .map((name) => ({
              path: [name],
              code: 1003,
              messageText: `Unknown Workman content mapper option: ${name}`,
            })),
        };
      }
      case "transform": {
        const handle = projectHandle(params);
        if (!this.projects.has(handle)) throw new RpcError(-32602, "Unknown project handle");
        if (typeof params?.fileName !== "string" || typeof params.content !== "string") {
          throw new RpcError(-32602, "transform requires fileName and content strings");
        }
        return await projectWorkman(params.fileName, params.content);
      }
      case "closeProject":
        this.projects.delete(projectHandle(params));
        return {};
      default:
        throw new RpcError(-32601, `Unknown method: ${method}`);
    }
  }
}

function projectHandle(params: Record<string, unknown> | undefined): string {
  if (typeof params?.projectHandle !== "string") {
    throw new RpcError(-32602, "Missing projectHandle");
  }
  return params.projectHandle;
}

export async function runContentMapper(): Promise<void> {
  const mapper = new ContentMapper();
  let buffer: Uint8Array<ArrayBufferLike> = new Uint8Array();
  for await (const chunk of process.stdin) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    const next = new Uint8Array(buffer.length + bytes.length);
    next.set(buffer);
    next.set(bytes, buffer.length);
    const decoded = decodeMessages(next);
    buffer = decoded.rest;
    for (const error of decoded.errors) {
      await write({ jsonrpc: "2.0", id: error.id, error });
    }
    // Sequential dispatch also protects WM's current process-global inference state.
    for (const message of decoded.messages) {
      if (!message.method || message.id === undefined) continue;
      let response: RpcMessage;
      try {
        response = {
          jsonrpc: "2.0",
          id: message.id,
          result: await mapper.request(message.method, message.params),
        };
      } catch (error) {
        response = {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: error instanceof RpcError ? error.code : -32603,
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
      await write(response);
    }
  }
}

async function write(message: RpcMessage): Promise<void> {
  const data = encodeMessage(message);
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(data, (error) => error ? reject(error) : resolve());
  });
}

if (import.meta.main) await runContentMapper();
