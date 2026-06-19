export type ProviderAuth = {
  bearerToken: string;
  organization?: string;
  project?: string;
};

export type ModelMessageInput = {
  type: "message";
  role: "system" | "user" | "assistant";
  content: string;
};

export type ModelFunctionCallOutputInput = {
  type: "function_call_output";
  callId: string;
  output: string;
};

export type ModelFunctionCallInput = {
  type: "function_call";
  callId: string;
  name: string;
  arguments: string;
  providerItemId?: string;
  rawProviderItem?: Record<string, unknown>;
};

export type ModelReasoningInput = {
  type: "reasoning";
  providerItemId?: string;
  rawProviderItem: Record<string, unknown>;
};

export type ModelInput =
  | ModelMessageInput
  | ModelFunctionCallInput
  | ModelFunctionCallOutputInput
  | ModelReasoningInput;

export type ModelTool = {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
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
  conversationId?: number;
  model: string;
  instructions?: string;
  input: ModelInput[];
  tools?: ModelTool[];
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
  | { type: "conversation.created"; conversationId: number }
  | { type: "response.created"; id: string }
  | { type: "text.delta"; delta: string }
  | { type: "tool_call"; callId: string; name: string; arguments: string }
  | { type: "response.completed"; id?: string; outputText?: string; usage?: unknown }
  | { type: "error"; status?: number; code?: string; message: string };

export type ModelClient = {
  stream(request: ModelCallRequest): AsyncIterable<ModelStreamEvent>;
  close?(): void;
};
