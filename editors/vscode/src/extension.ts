import * as fs from "fs";
import * as path from "path";
import {
  commands,
  type ExtensionContext,
  MarkdownString,
  StatusBarAlignment,
  type TextEditor,
  window,
  workspace,
} from "vscode";
import {
  LanguageClient,
  type LanguageClientOptions,
  type ServerOptions,
  TransportKind,
} from "vscode-languageclient/node";
import { Trace } from "vscode-jsonrpc";
import { denoServerConfig, nodeServerConfig, resolveConfiguredPath } from "./server_options";

let client: LanguageClient | undefined;

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
  const outputChannel = window.createOutputChannel("Workman Language Server");
  context.subscriptions.push(outputChannel);

  // Displays which project head owns the active file, so head selection and
  // stability (one `main` head plus its reachable graph) are observable in real use.
  const projectStatusItem = window.createStatusBarItem(StatusBarAlignment.Left, 90);
  projectStatusItem.name = "Workman Project";
  context.subscriptions.push(projectStatusItem);

  const updateProjectStatus = async (editor: TextEditor | undefined) => {
    if (!editor || editor.document.languageId !== "wm" || !client || !client.isRunning()) {
      projectStatusItem.hide();
      return;
    }
    try {
      const status = await client.sendRequest<ProjectStatusResult>(
        "workman/projectStatus",
        { textDocument: { uri: editor.document.uri.toString() } },
      );
      renderProjectStatus(projectStatusItem, status);
    } catch {
      projectStatusItem.hide();
    }
  };
  context.subscriptions.push(
    window.onDidChangeActiveTextEditor((editor) => void updateProjectStatus(editor)),
  );

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
          // Revalidation may have changed which project owns the active file.
          void updateProjectStatus(window.activeTextEditor);
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

function renderProjectStatus(
  item: ReturnType<typeof window.createStatusBarItem>,
  status: ProjectStatusResult,
): void {
  const selected = status.selected;
  if (!selected) {
    item.hide();
    return;
  }
  const headName = path.basename(selected.headPath);
  item.text = selected.kind === "headed"
    ? `$(symbol-structure) WM: ${headName}${selected.recovered ? " ⚠" : ""}`
    : `$(symbol-structure) WM: detached`;

  const tooltip = new MarkdownString();
  tooltip.appendMarkdown(
    selected.kind === "headed"
      ? `**Project head:** \`${selected.headPath}\`\n\n${selected.moduleCount} module(s)`
      : `**Detached document** (no \`main\` head selects this file)`,
  );
  if (selected.recovered) {
    tooltip.appendMarkdown("\n\n⚠ strict analysis failed; showing recovered facts");
  }
  const others = status.activeHeads.filter((head) => head.headPath !== selected.headPath);
  if (others.length > 0) {
    tooltip.appendMarkdown("\n\n**Other active projects:**");
    for (const head of others) {
      tooltip.appendMarkdown(
        `\n- \`${head.headPath}\` (${head.moduleCount} module(s)` +
          `${head.containsDocument ? ", also contains this file" : ""})`,
      );
    }
  }
  item.tooltip = tooltip;
  item.show();
}

function traceSetting(): Trace {
  const value = workspace.getConfiguration("workman").get<string>(
    "trace.server",
  );
  if (value === "verbose") return Trace.Verbose;
  if (value === "messages") return Trace.Messages;
  return Trace.Off;
}
