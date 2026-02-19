import * as vscode from "vscode";
import { TrpcWebviewProvider } from "./webviewProvider";
import { logger } from "../lib/logging/logger";

export function activate(context: vscode.ExtensionContext) {
  logger.logInfo("Activating tRPC Explorer extension");
  const webviewProvider = new TrpcWebviewProvider(context.extensionUri);

  const devMode = context.globalState.get<boolean>(
    "trpcExplorer.devMode",
    false,
  );
  if (devMode) {
    logger.setOutputLevel("DEBUG");
    logger.show();
    logger.logInfo("Developer mode restored: DEBUG logging enabled");
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      TrpcWebviewProvider.viewType,
      webviewProvider,
    ),
  );

  const typescriptFileWatcher =
    vscode.workspace.createFileSystemWatcher("**/*.ts");
  typescriptFileWatcher.onDidChange(() => {
    logger.logDebug("TypeScript file changed, refreshing webview");
    webviewProvider.refresh();
  });
  typescriptFileWatcher.onDidCreate(() => {
    logger.logDebug("TypeScript file created, refreshing webview");
    webviewProvider.refresh();
  });
  typescriptFileWatcher.onDidDelete(() => {
    logger.logDebug("TypeScript file deleted, refreshing webview");
    webviewProvider.refresh();
  });

  context.subscriptions.push(
    typescriptFileWatcher,
    vscode.commands.registerCommand("trpc-explorer.refresh", () => {
      logger.logInfo("Manual refresh requested");
      webviewProvider.refresh();
    }),
    vscode.commands.registerCommand("trpc-explorer.enableDevMode", async () => {
      await context.globalState.update("trpcExplorer.devMode", true);
      logger.setOutputLevel("DEBUG");
      logger.show();
      logger.logInfo("Developer mode enabled");
      void vscode.window.showInformationMessage(
        "tRPC Explorer: Developer mode enabled (debug logging)",
      );
    }),
    vscode.commands.registerCommand(
      "trpc-explorer.disableDevMode",
      async () => {
        await context.globalState.update("trpcExplorer.devMode", false);
        logger.setOutputLevel("INFO");
        logger.logInfo("Developer mode disabled");
        void vscode.window.showInformationMessage(
          "tRPC Explorer: Developer mode disabled",
        );
      },
    ),
  );
}

export function deactivate() {
  logger.logInfo("Deactivating tRPC Explorer extension");
}
