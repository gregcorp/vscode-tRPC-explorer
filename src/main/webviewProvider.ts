import * as fs from "fs";
import * as vscode from "vscode";
import { discoverAppRouterTrees } from "../parser/routerDiscovery";
import { TrpcNode, WebviewTrpcNode } from "../lib/types";
import { zodExpressionToReadableType } from "../lib/zodPrettifier";
import { logger } from "../lib/logging/logger";

export class TrpcWebviewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = "trpc-explorer-view";

  private webviewView?: vscode.WebviewView;
  private cachedTrees: TrpcNode[] | null = null;

  constructor(private readonly extensionUri: vscode.Uri) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this.webviewView = webviewView;

    logger.logInfo("Webview view resolved");

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    webviewView.webview.html = this.buildWebviewHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      switch (msg.type) {
        case "navigate": {
          const uri = vscode.Uri.file(msg.filePath);
          const line = Math.max(0, (msg.line ?? 1) - 1);
          await vscode.window.showTextDocument(uri, {
            selection: new vscode.Range(line, 0, line, 0),
          });
          break;
        }
        case "ready":
          logger.logDebug("Webview reported ready, sending tree");
          await this.sendTree();
          break;
      }
    });
  }

  async refresh(): Promise<void> {
    this.cachedTrees = null;
    logger.logDebug("Refresh called on TrpcWebviewProvider");
    await this.sendTree();
  }

  private async sendTree(): Promise<void> {
    this.webviewView?.webview.postMessage({ type: "loading" });
    const trees = await this.resolveTrees();
    logger.logInfo(`Sending ${trees.length} router tree(s) to webview`);
    this.webviewView?.webview.postMessage({
      type: "update",
      data: trees.map(mapNodeToWebviewNode),
    });
  }

  private async resolveTrees(): Promise<TrpcNode[]> {
    if (this.cachedTrees) {
      logger.logDebug("Returning cached router trees");
      return this.cachedTrees;
    }
    const trees = await discoverAppRouterTrees();
    logger.logInfo(`Discovered ${trees.length} router tree(s)`);
    this.cachedTrees = trees;
    return trees;
  }

  private buildWebviewHtml(webview: vscode.Webview): string {
    const distUri = vscode.Uri.joinPath(this.extensionUri, "dist", "webview");
    const indexHtmlPath = vscode.Uri.joinPath(distUri, "index.html").fsPath;

    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "main.js"),
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(distUri, "main.css"),
    );
    const nonce = generateNonce();

    try {
      const builtIndexHtml = fs.readFileSync(indexHtmlPath, "utf8");
      return adaptBuiltWebviewHtml(builtIndexHtml, {
        cspSource: webview.cspSource,
        nonce,
        scriptUri: scriptUri.toString(),
        styleUri: styleUri.toString(),
      });
    } catch {
      logger.logWarning(
        `Unable to read built webview index at ${indexHtmlPath}`,
      );
      return `<html><body><p>Unable to load webview UI. Run the webview build first.</p></body></html>`;
    }
  }
}

function adaptBuiltWebviewHtml(
  html: string,
  options: {
    cspSource: string;
    nonce: string;
    scriptUri: string;
    styleUri: string;
  },
): string {
  const contentSecurityPolicy = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${options.cspSource}; script-src 'nonce-${options.nonce}';" />`;
  const styleLink = `<link rel="stylesheet" href="${options.styleUri}" />`;
  const scriptTag = `<script type="module" nonce="${options.nonce}" src="${options.scriptUri}"></script>`;

  let adaptedHtml = html
    .replace(/<meta\s+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, "")
    .replace(/<link[^>]*href=["'][^"']*main\.css["'][^>]*>/gi, "")
    .replace(
      /<script[^>]*src=["'][^"']*(?:main\.js|src\/main\.ts)["'][^>]*><\/script>/gi,
      "",
    );

  adaptedHtml = adaptedHtml.replace(
    /<head>/i,
    `<head>\n  ${contentSecurityPolicy}\n  ${styleLink}`,
  );

  if (/<\/body>/i.test(adaptedHtml)) {
    return adaptedHtml.replace(/<\/body>/i, `  ${scriptTag}\n</body>`);
  }

  return `${adaptedHtml}\n${scriptTag}`;
}

function generateNonce(): string {
  let text = "";
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}

function mapNodeToWebviewNode(node: TrpcNode): WebviewTrpcNode {
  const canFormatInputSchema = looksLikeInlineZodSchema(node.inputSchema);
  const canFormatOutputSchema = looksLikeInlineZodSchema(node.outputSchema);

  return {
    name: node.name,
    type: node.type,
    filePath: node.filePath,
    line: node.line,
    inputSchema: node.inputSchema,
    outputSchema: node.outputSchema,
    prettyInput:
      node.inputSchema && canFormatInputSchema
        ? zodExpressionToReadableType(node.inputSchema)
        : undefined,
    prettyOutput:
      node.outputSchema && canFormatOutputSchema
        ? zodExpressionToReadableType(node.outputSchema)
        : undefined,
    children: node.children.map(mapNodeToWebviewNode),
  };
}

function looksLikeInlineZodSchema(schemaText: string | undefined): boolean {
  if (!schemaText) {
    return false;
  }

  return /^\s*z\./.test(schemaText);
}
