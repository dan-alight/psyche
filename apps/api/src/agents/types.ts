import type {
  ModelCallRequest,
  ModelInput,
  ModelResponseFormat,
  ModelStreamEvent,
  ModelTool
} from "@/modelClients/types";

export type AgentRunInput = {
  providerKey: string;
  model: string;
  conversationId?: number;
  instructions?: string;
  input: ModelInput[];
  tools?: ModelTool[];
  store?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  responseFormat?: ModelResponseFormat;
  reasoning?: ModelCallRequest["reasoning"];
  verbosity?: ModelCallRequest["verbosity"];
  metadata?: Record<string, string>;
  maxTurns?: number;
  signal?: AbortSignal;
};

export type AgentRunStartedEvent = {
  type: "run.started";
  providerKey: string;
  model: string;
  conversationId?: number;
};

export type AgentRunCompletedEvent = {
  type: "run.completed";
  conversationId?: number;
  responseId?: string;
};

export type AgentRunFailedEvent = {
  type: "run.failed";
  message: string;
  status?: number;
  code?: string;
};

export type AgentRunEvent =
  | AgentRunStartedEvent
  | ModelStreamEvent
  | AgentRunCompletedEvent
  | AgentRunFailedEvent;

