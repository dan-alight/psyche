export type ProviderAuth = {
  bearerToken: string;
  organization?: string;
  project?: string;
};

export type ModelMessageInput = {
  type?: "message";
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelToolOutputInput = {
  type: "function_call_output";
  callId: string;
  output: string;
};

export type ModelInput = ModelMessageInput | ModelToolOutputInput;

export type ModelTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
};

export type ModelResponseFormat =
  | { type: "text" }
  | {
      type: "json_schema";
      name: string;
      schema: Record<string, unknown>;
      strict?: boolean;
    };

export type ModelCallRequest = {
  model: string;
  instructions?: string;
  input: ModelInput[];
  tools?: ModelTool[];
  previousResponseId?: string;
  store?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: ModelResponseFormat;
  reasoning?: {
    effort?: "none" | "minimal" | "low" | "medium" | "high" | "xhigh";
  };
  verbosity?: "low" | "medium" | "high";
  metadata?: Record<string, string>;
  signal?: AbortSignal;
};

export type ModelStreamEvent =
  | { type: "response.created"; id: string }
  | { type: "text.delta"; delta: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "response.completed"; id?: string; outputText?: string; usage?: unknown }
  | { type: "error"; status?: number; code?: string; message: string };

export type ModelClient = {
  stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent>;
};
