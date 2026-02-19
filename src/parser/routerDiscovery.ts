import * as vscode from "vscode";
import {
  APP_ROUTER_DISPLAY_NAME,
  NODE_MODULES_GLOB,
  ROUTER_DISCOVERY_PATTERNS,
} from "../lib/constants";
import { findAppRoutersInFile, parseRouterFromFile } from "./parser";
import { TrpcNode } from "../lib/types";
import { logger } from "../lib/logging/logger";

export async function discoverAppRouterTrees(): Promise<TrpcNode[]> {
  logger.logInfo("Starting discovery of AppRouter trees");
  const discoveredFilePaths = new Set<string>();
  const prioritizedCandidates: vscode.Uri[] = [];

  for (const pattern of ROUTER_DISCOVERY_PATTERNS) {
    const files = await vscode.workspace.findFiles(pattern, NODE_MODULES_GLOB);
    for (const file of files) {
      if (discoveredFilePaths.has(file.fsPath)) {
        continue;
      }
      discoveredFilePaths.add(file.fsPath);
      prioritizedCandidates.push(file);
    }
  }

  const routerTrees: TrpcNode[] = [];
  const parsedRouterKeys = new Set<string>();

  for (const uri of prioritizedCandidates) {
    addTreesFromFile(uri.fsPath, routerTrees, parsedRouterKeys);
  }

  const allTsFiles = await vscode.workspace.findFiles(
    "**/*.ts",
    NODE_MODULES_GLOB,
  );

  for (const uri of allTsFiles) {
    if (discoveredFilePaths.has(uri.fsPath)) {
      continue;
    }
    addTreesFromFile(uri.fsPath, routerTrees, parsedRouterKeys);
  }

  logDiscoveryCount(routerTrees);
  return routerTrees;
}

function logDiscoveryCount(routerTrees: TrpcNode[]) {
  logger.logInfo(
    `Router discovery completed: ${routerTrees.length} tree(s) found`,
  );
}

function addTreesFromFile(
  filePath: string,
  routerTrees: TrpcNode[],
  parsedRouterKeys: Set<string>,
): void {
  const varNames = findAppRoutersInFile(filePath);

  for (const varName of varNames) {
    const key = `${filePath}:${varName}`;
    if (parsedRouterKeys.has(key)) {
      continue;
    }
    parsedRouterKeys.add(key);

    const tree = parseRouterFromFile(filePath, varName);
    if (!tree) {
      continue;
    }

    tree.name = APP_ROUTER_DISPLAY_NAME;
    routerTrees.push(tree);
  }
}
