import * as fs from "fs";
import * as path from "path";
import { commands, type ExtensionContext, window, workspace } from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { Trace } from "vscode-jsonrpc";
import { denoServerConfig, nodeServerConfig, resolveConfiguredPath } from "./server_options";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  const outputChannel = window.createOutputChannel("Workman Language Server");
  context.subscriptions.push(outputChannel);

  const start = async () => {
    const server = resolveServer(context);
    if (!server) {
      const message =
        "Workman language server is unavailable. Reinstall the extension or set workman.serverPath to your Workman src/lsp/server.ts checkout.";
      outputChannel.appendLine(message);
      window.showErrorMessage(message);
      return;
    }

    const denoPath = workspace.getConfiguration("workman").get<string>("denoPath") || "deno";
    const frontendMode = workspace.getConfiguration("workman").get<string>("frontendMode") || "v1";
    const frontendV2ModulePath = workspace.getConfiguration("workman").get<
      string
    >(
      "frontendV2ModulePath",
    )?.trim();
    const structuralInlays = workspace.getConfiguration("workman").get<boolean>(
      "structuralInlayHints.enabled",
      true,
    );
    const serverEnvironment = {
      ...process.env,
      WORKMAN_DENO_PATH: denoPath,
      WORKMAN_STRUCTURAL_INLAYS: String(structuralInlays),
    };
    outputChannel.appendLine(
      `Starting Workman language server: ${server.path}`,
    );
    const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;
    const serverOptions: ServerOptions = server.kind === "source"
      ? {
        run: denoServerConfig(
          denoPath,
          server.path,
          frontendMode,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
        debug: denoServerConfig(
          denoPath,
          server.path,
          frontendMode,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
      }
      : {
        run: nodeServerConfig(
          server.path,
          frontendMode,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
        debug: nodeServerConfig(
          server.path,
          frontendMode,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
      };
    const clientOptions: LanguageClientOptions = {
      documentSelector: [{ scheme: "file", language: "wm" }],
      synchronize: {
        fileEvents: workspace.createFileSystemWatcher("**/*.wm"),
      },
      middleware: {
        handleDiagnostics: (uri, diagnostics, next) => {
          outputChannel.appendLine(
            `[workman-client] diagnostics uri=${uri.toString()} count=${diagnostics.length}`,
          );
          next(uri, diagnostics);
        },
        provideHover: async (document, position, token, next) => {
          const hover = await next(document, position, token);
          outputChannel.appendLine(
            `[workman-client] hover uri=${document.uri.toString()} ` +
              `line=${position.line} char=${position.character} result=${hover ? "hit" : "null"}`,
          );
          return hover;
        },
      },
      outputChannel,
      traceOutputChannel: outputChannel,
    };

    client = new LanguageClient(
      "workman",
      "Workman",
      serverOptions,
      clientOptions,
    );
    context.subscriptions.push(client);
    await client.start();
    await client.setTrace(traceSetting());
  };

  context.subscriptions.push(
    commands.registerCommand("workman.restartLanguageServer", async () => {
      outputChannel.appendLine("Restarting Workman language server...");
      if (client) {
        await client.stop();
        client = undefined;
      }
      await start();
    }),
  );

  await start();
}

export async function deactivate(): Promise<void> {
  await client?.stop();
}

type Server = { kind: "source" | "node"; path: string };

function resolveServer(context: ExtensionContext): Server | undefined {
  const configured = workspace.getConfiguration("workman").get<string>(
    "serverPath",
  )?.trim();
  const sourceCandidates = [
    configured
      ? resolveConfiguredPath(
        configured,
        workspace.workspaceFolders?.[0]?.uri.fsPath,
      )
      : undefined,
    ...workspace.workspaceFolders?.map((folder) =>
      path.join(folder.uri.fsPath, "src", "lsp", "server.ts")
    ) ?? [],
    path.resolve(context.extensionPath, "..", "..", "src", "lsp", "server.ts"),
  ];
  const source = sourceCandidates.find((candidate): candidate is string =>
    !!candidate && fs.existsSync(candidate)
  );
  if (source) return { kind: "source", path: source };

  const bundled = path.join(
    context.extensionPath,
    "server",
    "workman-lsp.mjs",
  );
  return fs.existsSync(bundled) ? { kind: "node", path: bundled } : undefined;
}

function traceSetting(): Trace {
  const value = workspace.getConfiguration("workman").get<string>(
    "trace.server",
  );
  if (value === "verbose") return Trace.Verbose;
  if (value === "messages") return Trace.Messages;
  return Trace.Off;
}
