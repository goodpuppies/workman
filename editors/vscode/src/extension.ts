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
import { denoServerConfig, resolveConfiguredPath } from "./server_options";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  const outputChannel = window.createOutputChannel("wm-mini Language Server");
  context.subscriptions.push(outputChannel);

  const start = async () => {
    const serverPath = resolveServerPath(context);
    if (!serverPath) {
      const message =
        "wm-mini language server not found. Set wmMini.serverPath to your wm-mini src/lsp/server.ts checkout.";
      outputChannel.appendLine(message);
      window.showErrorMessage(message);
      return;
    }

    const denoPath =
      workspace.getConfiguration("wmMini").get<string>("denoPath") || "deno";
    const frontendMode =
      workspace.getConfiguration("wmMini").get<string>("frontendMode") || "v1";
    const frontendV2ModulePath = workspace.getConfiguration("wmMini").get<
      string
    >(
      "frontendV2ModulePath",
    )?.trim();
    outputChannel.appendLine(`Starting wm-mini language server: ${serverPath}`);
    const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;
    const serverOptions: ServerOptions = {
      run: denoServerConfig(
        denoPath,
        serverPath,
        frontendMode,
        frontendV2ModulePath,
        TransportKind.stdio,
        process.env,
        workspaceFolder,
      ),
      debug: denoServerConfig(
        denoPath,
        serverPath,
        frontendMode,
        frontendV2ModulePath,
        TransportKind.stdio,
        process.env,
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
            `[wm-client] diagnostics uri=${uri.toString()} count=${diagnostics.length}`,
          );
          next(uri, diagnostics);
        },
        provideHover: async (document, position, token, next) => {
          const hover = await next(document, position, token);
          outputChannel.appendLine(
            `[wm-client] hover uri=${document.uri.toString()} ` +
              `line=${position.line} char=${position.character} result=${
                hover ? "hit" : "null"
              }`,
          );
          return hover;
        },
      },
      outputChannel,
      traceOutputChannel: outputChannel,
    };

    client = new LanguageClient(
      "wm-mini",
      "wm-mini",
      serverOptions,
      clientOptions,
    );
    context.subscriptions.push(client);
    await client.start();
    await client.setTrace(traceSetting());
  };

  context.subscriptions.push(
    commands.registerCommand("wm-mini.restartLanguageServer", async () => {
      outputChannel.appendLine("Restarting wm-mini language server...");
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

function resolveServerPath(context: ExtensionContext): string | undefined {
  const configured = workspace.getConfiguration("wmMini").get<string>(
    "serverPath",
  )?.trim();
  const candidates = [
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
  return candidates.find((candidate): candidate is string =>
    !!candidate && fs.existsSync(candidate)
  );
}

function traceSetting(): Trace {
  const value = workspace.getConfiguration("wmMini").get<string>(
    "trace.server",
  );
  if (value === "verbose") return Trace.Verbose;
  if (value === "messages") return Trace.Messages;
  return Trace.Off;
}
