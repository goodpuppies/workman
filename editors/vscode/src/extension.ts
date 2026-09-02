import * as fs from "fs";
import * as path from "path";
import {
  commands,
  type CancellationToken,
  type ExtensionContext,
  MarkdownString,
  type OutputChannel,
  StatusBarAlignment,
  type TextEditor,
  Uri,
  window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { type MessageSignature, Trace } from "vscode-jsonrpc";
import {
  nodeServerConfig,
  probeServerCommand,
  resolveConfiguredPath,
  wmServerConfig,
} from "./server_options";

let client: LanguageClient | undefined;

class WorkmanLanguageClient extends LanguageClient {
  override handleFailedRequest<T>(
    type: MessageSignature,
    token: CancellationToken | undefined,
    error: unknown,
    defaultValue: T,
    _showNotification = true,
    throwOnCancel = false,
  ): T {
    // Source-analysis failures are published separately as file diagnostics.
    // Keep feature-request failures in the output channel instead of showing a
    // popup for every hover, inlay, token, or completion request VS Code retries.
    return super.handleFailedRequest(
      type,
      token,
      error,
      defaultValue,
      false,
      throwOnCancel,
    );
  }
}

type ProjectStatusResult = {
  selected: {
    kind: "headed" | "detached";
    headPath: string;
    moduleCount: number;
    recovered: boolean;
  } | null;
  activeHeads: {
    kind: "headed" | "detached";
    headPath: string;
    moduleCount: number;
    containsDocument: boolean;
  }[];
};

export async function activate(context: ExtensionContext) {
  const outputChannel = window.createOutputChannel("Workman Language Server", {
    log: true,
  });
  context.subscriptions.push(outputChannel);

  // Displays which project head owns the active file, so head selection and
  // stability (one `main` head plus its reachable graph) are observable in real use.
  const projectStatusItems = [createProjectStatusItem(90)];
  context.subscriptions.push(...projectStatusItems);

  const updateProjectStatus = async (editor: TextEditor | undefined) => {
    if (
      !editor || editor.document.languageId !== "wm" || !client ||
      !client.isRunning()
    ) {
      projectStatusItems.forEach((item) => item.hide());
      return;
    }
    try {
      const status = await client.sendRequest<ProjectStatusResult>(
        "workman/projectStatus",
        { textDocument: { uri: editor.document.uri.toString() } },
      );
      renderProjectStatus(projectStatusItems, status, context);
    } catch {
      projectStatusItems.forEach((item) => item.hide());
    }
  };
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((editor) =>
      void updateProjectStatus(editor)
    ),
  );

  const start = async () => {
    const server = await resolveServer(context, outputChannel);
    if (!server) {
      const message =
        "Workman language server is unavailable. Install the `wm` CLI on PATH, reinstall the extension, or set workman.serverPath to a Workman language server bundle or `wm` launcher.";
      outputChannel.appendLine(message);
      window.showErrorMessage(message);
      return;
    }

    const denoPath =
      workspace.getConfiguration("workman").get<string>("denoPath") || "deno";
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
      `Starting Workman language server (${server.kind}): ${server.path}`,
    );
    const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;
    const serverOptions: ServerOptions = server.kind === "wm"
      ? {
        run: wmServerConfig(
          server.path,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
        debug: wmServerConfig(
          server.path,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
      }
      : {
        run: nodeServerConfig(
          server.path,
          frontendV2ModulePath,
          TransportKind.stdio,
          serverEnvironment,
          workspaceFolder,
        ),
        debug: nodeServerConfig(
          server.path,
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
          // Revalidation may have changed which project owns the active file.
          void updateProjectStatus(window.activeTextEditor);
        },
        provideHover: async (document, position, token, next) => {
          const hover = await next(document, position, token);
          outputChannel.appendLine(
            `[workman-client] hover uri=${document.uri.toString()} ` +
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

    client = new WorkmanLanguageClient(
      "workman",
      "Workman",
      serverOptions,
      clientOptions,
    );
    context.subscriptions.push(client);
    await client.start();
    await client.setTrace(traceSetting());
    void updateProjectStatus(window.activeTextEditor);
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

type Server = { kind: "wm" | "node"; path: string };

/**
 * Resolution order:
 * 1. `workman.serverPath`, when it exists — a JavaScript server bundle or a
 *    `wm` launcher script/binary.
 * 2. `wm lsp` from PATH, when the command launches and exits cleanly.
 * 3. The server bundle packaged inside the extension.
 *
 * There is deliberately no source-checkout mode: on development machines `wm`
 * itself runs the checkout, so `wm lsp` already serves the freshest sources.
 */
async function resolveServer(
  context: ExtensionContext,
  outputChannel: OutputChannel,
): Promise<Server | undefined> {
  const configured = workspace.getConfiguration("workman").get<string>(
    "serverPath",
  )?.trim();
  if (configured) {
    const resolved = resolveConfiguredPath(
      configured,
      workspace.workspaceFolders?.[0]?.uri.fsPath,
    );
    if (fs.existsSync(resolved)) {
      return /\.(?:mjs|cjs|js)$/i.test(resolved)
        ? { kind: "node", path: resolved }
        : { kind: "wm", path: resolved };
    }
    outputChannel.appendLine(`workman.serverPath does not exist: ${resolved}`);
  }
  const workspaceFolder = workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (await probeServerCommand("wm", ["lsp"], { cwd: workspaceFolder })) {
    return { kind: "wm", path: "wm" };
  }
  outputChannel.appendLine(
    "wm lsp probe failed; falling back to the bundled language server",
  );
  const bundled = path.join(
    context.extensionPath,
    "server",
    "workman-lsp.mjs",
  );
  return fs.existsSync(bundled) ? { kind: "node", path: bundled } : undefined;
}


function createProjectStatusItem(priority: number) {
  const item = window.createStatusBarItem(StatusBarAlignment.Left, priority);
  item.name = "Workman Project";
  return item;
}

function renderProjectStatus(
  items: ReturnType<typeof window.createStatusBarItem>[],
  status: ProjectStatusResult,
  context: ExtensionContext,
): void {
  const selected = status.selected;
  if (!selected) {
    items.forEach((item) => item.hide());
    return;
  }
  const heads = [
    { ...selected, containsDocument: true },
    ...status.activeHeads.filter((head) => head.headPath !== selected.headPath),
  ];
  while (items.length < heads.length) {
    const item = createProjectStatusItem(90 - items.length);
    items.push(item);
    context.subscriptions.push(item);
  }

  heads.forEach((head, index) => {
    const item = items[index];
    const displayPath = projectDisplayPath(head.headPath);
    item.text = head.kind === "headed"
      ? `${index === 0 ? "$(symbol-structure) WM: " : ""}${displayPath}` +
        `${index === 0 && selected.recovered ? " ⚠" : ""}`
      : `${index === 0 ? "$(symbol-structure) WM: " : ""}detached`;
    const tooltip = new MarkdownString();
    tooltip.appendMarkdown(
      head.kind === "headed"
        ? `**Project head:** \`${displayPath}\`\n\n${head.moduleCount} module(s)`
        : `**Detached document:** \`${displayPath}\` (no \`main\` head selects this file)`,
    );
    if (index === 0 && selected.recovered) {
      tooltip.appendMarkdown(
        "\n\n⚠ strict analysis failed; showing recovered facts",
      );
    }
    if (head.containsDocument && index > 0) {
      tooltip.appendMarkdown("\n\nAlso contains the active file");
    }
    item.tooltip = tooltip;
    item.command = {
      command: "vscode.open",
      title: "Open Workman project head",
      arguments: [Uri.file(head.headPath)],
    };
    item.show();
  });
  items.slice(heads.length).forEach((item) => item.hide());
}

function projectDisplayPath(headPath: string): string {
  const folder = workspace.getWorkspaceFolder(Uri.file(headPath));
  return folder
    ? path.relative(folder.uri.fsPath, headPath) || path.basename(headPath)
    : headPath;
}

function traceSetting(): Trace {
  const value = workspace.getConfiguration("workman").get<string>(
    "trace.server",
  );
  if (value === "verbose") return Trace.Verbose;
  if (value === "messages") return Trace.Messages;
  return Trace.Off;
}
