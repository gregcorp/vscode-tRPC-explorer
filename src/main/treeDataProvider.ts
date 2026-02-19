import * as vscode from "vscode";
import * as path from "path";
import { discoverAppRouterTrees } from "../parser/routerDiscovery";
import { TrpcTreeItem } from "./trpcTreeItem";
import { TrpcNode } from "../lib/types";
import { createNoResultItem } from "../parser/noResultItem";
import { logger } from "../lib/logging/logger";

export class TrpcTreeProvider implements vscode.TreeDataProvider<TrpcTreeItem> {
  private treeDataChangedEmitter = new vscode.EventEmitter<
    TrpcTreeItem | undefined | null | void
  >();
  readonly onDidChangeTreeData = this.treeDataChangedEmitter.event;

  private cachedTrees: TrpcNode[] | null = null;

  refresh(): void {
    this.cachedTrees = null;
    logger.logDebug("Tree provider refresh requested");
    this.treeDataChangedEmitter.fire();
  }

  getTreeItem(element: TrpcTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TrpcTreeItem): Promise<TrpcTreeItem[]> {
    if (!vscode.workspace.workspaceFolders) {
      return [];
    }

    if (element) {
      return element.node.children.map((child) => new TrpcTreeItem(child));
    }

    const trees = await this.resolveTrees();
    logger.logDebug(`getChildren: resolved ${trees.length} tree(s)`);
    if (!trees.length) {
      return [
        createNoResultItem(
          "No AppRouter found. Export type AppRouter = typeof appRouter",
        ),
      ];
    }

    // groups routers into a file node if multiple routers are defined in the same file
    const groupedByFile = new Map<string, TrpcNode[]>();
    for (const tree of trees) {
      const key = tree.filePath ?? "";
      const arr = groupedByFile.get(key) ?? [];
      arr.push(tree);
      groupedByFile.set(key, arr);
    }

    const items: TrpcTreeItem[] = [];
    for (const [filePath, group] of groupedByFile.entries()) {
      if (!filePath || group.length === 1) {
        // single router, don't bother creating a file node
        items.push(new TrpcTreeItem(group[0]));
        continue;
      }

      // create a file node that groups all routers
      const fileNode: TrpcNode = {
        name: path.basename(filePath),
        type: "file",
        children: group,
        filePath,
      };

      items.push(new TrpcTreeItem(fileNode));
    }

    return items;
  }

  private async resolveTrees(): Promise<TrpcNode[]> {
    if (this.cachedTrees) {
      logger.logDebug("Tree provider returning cached trees");
      return this.cachedTrees;
    }
    const trees = await discoverAppRouterTrees();
    logger.logInfo(`Tree provider discovered ${trees.length} tree(s)`);
    this.cachedTrees = trees;
    return trees;
  }
}
