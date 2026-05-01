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

export type MatchStrategy = "exact" | "normalized" | "fuzzy" | "user";

/**
 * User-supplied matcher. Returns `true` to claim a recorded pair as
 * a match for the incoming request, `false` to defer to the built-in
 * tiers.
 */
export type UserMatcher = (
  request: JsonRpcMessage,
  recorded: ReplayPair,
) => boolean;

export interface ReplayPair {
  request: JsonRpcMessage;
  response: JsonRpcMessage;
}

/**
 * A request paired with every response frame it produced. Used by
 * the HTTP transport when serving SSE: a single client POST can fan
 * out into multiple server-side messages (progress notifications, a
 * final response). For non-streaming requests, `responses` has length 1.
 */
export interface StreamedReplayPair {
  request: JsonRpcMessage;
  responses: JsonRpcMessage[];
}
