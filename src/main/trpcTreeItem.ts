import * as vscode from "vscode";
import { TRPC_TREE_ICONS } from "../lib/constants";
import { countProcedures } from "../parser/treeHelpers";
import { TrpcNode } from "../lib/types";

export class TrpcTreeItem extends vscode.TreeItem {
  constructor(public readonly node: TrpcNode) {
    const isCollapsible = node.type === "router" || node.type === "file";
    super(
      node.name,
      isCollapsible
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
    );

    this.iconPath = TRPC_TREE_ICONS[node.type];
    this.contextValue = node.type;

    if (node.type === "file") {
      if (node.filePath) {
        this.description = vscode.workspace.asRelativePath(node.filePath);
      }
    } else if (node.type !== "router") {
      const parts: string[] = [node.type];
      if (node.inputSchema) {
        parts.push(node.inputSchema);
      }
      this.description = parts.join(" · ");
    } else {
      const counts = countProcedures(node);
      const badges: string[] = [];
      if (counts.query) {
        badges.push(`${counts.query}q`);
      }
      if (counts.mutation) {
        badges.push(`${counts.mutation}m`);
      }
      if (counts.subscription) {
        badges.push(`${counts.subscription}s`);
      }
      this.description = badges.join(" ");
    }

    if (node.filePath && node.line) {
      const uri = vscode.Uri.file(node.filePath);
      this.command = {
        command: "vscode.open",
        title: "Go to definition",
        arguments: [
          uri,
          <vscode.TextDocumentShowOptions>{
            selection: new vscode.Range(node.line - 1, 0, node.line - 1, 0),
          },
        ],
      };
    }

    if (node.type !== "router" && node.type !== "file") {
      const md = new vscode.MarkdownString();
      md.appendMarkdown(`**${node.name}** — \`${node.type}\`\n\n`);
      if (node.inputSchema) {
        md.appendCodeblock(node.inputSchema, "typescript");
      }
      this.tooltip = md;
    }
  }
}
