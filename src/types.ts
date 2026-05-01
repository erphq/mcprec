export type Direction = "→" | "←";

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export type JsonRpcMessage =
  | JsonRpcRequest
  | JsonRpcNotification
  | JsonRpcResponse;

export interface Frame {
  t: number;
  dir: Direction;
  msg: JsonRpcMessage;
}

export type MatchStrategy = "exact" | "normalized";

export interface ReplayPair {
  request: JsonRpcMessage;
  response: JsonRpcMessage;
}
