import * as vscode from "vscode";
import { TrpcTreeItem } from "../main/trpcTreeItem";
import { TrpcNode } from "../lib/types";

export function createNoResultItem(text: string): TrpcTreeItem {
  const placeholderNode: TrpcNode = {
    name: text,
    type: "router",
    children: [],
  };

  const item = new TrpcTreeItem(placeholderNode);
  item.collapsibleState = vscode.TreeItemCollapsibleState.None;
  item.iconPath = new vscode.ThemeIcon("warning");
  return item;
}
