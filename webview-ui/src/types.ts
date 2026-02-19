export interface TrpcNodeData {
  name: string;
  type: "router" | "query" | "mutation" | "subscription";
  children: TrpcNodeData[];
  filePath?: string;
  line?: number;
  inputSchema?: string;
  outputSchema?: string;
  prettyInput?: string;
  prettyOutput?: string;
}
