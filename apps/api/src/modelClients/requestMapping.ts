import type { ConversationItem } from "@/db/schema";
import type { ModelCallRequest, ModelInput, ModelTool } from "@/modelClients/types";

export function toResponsesInput(input: ModelInput[]) {
  return input.flatMap((item): Array<Record<string, unknown>> => {
    if (item.type === "function_call_output") {
      return [removeUndefined({
        type: "function_call_output",
        call_id: item.callId,
        output: item.output
      })];
    }

    if (item.type === "function_call") {
      return [removeUndefined({
        type: "function_call",
        id: item.providerItemId,
        call_id: item.callId,
        name: item.name,
        arguments: item.arguments
      })];
    }

    if (item.type === "reasoning") {
      return [{
        ...item.rawProviderItem,
        type: "reasoning",
        ...(item.providerItemId ? { id: item.providerItemId } : {})
      }];
    }

    return [{
      type: "message",
      role: item.role,
      content: [{ type: "input_text", text: item.content }]
    }];
  });
}

export function toResponsesTools(tools: ModelTool[] | undefined) {
  return tools?.map((tool): Record<string, unknown> => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    strict: tool.strict
  }));
}

export function toResponsesCreateEvent(request: ModelCallRequest, options: { previousResponseId?: string } = {}) {
  return removeUndefined({
    type: "response.create",
    model: request.model,
    instructions: request.instructions,
    input: toResponsesInput(request.input),
    tools: toResponsesTools(request.tools),
    previous_response_id: options.previousResponseId,
    store: request.store ?? false,
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    text: request.responseFormat ? toResponsesTextConfig(request.responseFormat) : undefined,
    reasoning: request.reasoning,
    verbosity: request.verbosity,
    metadata: request.metadata
  });
}

export function toChatCompletionsBody(request: ModelCallRequest, history: ConversationItem[] = []) {
  const messages = [...toChatMessagesFromConversation(history), ...toChatMessages(request.input)];

  return removeUndefined({
    model: request.model,
    messages: request.instructions
      ? [{ role: "system", content: request.instructions }, ...messages]
      : messages,
    tools: request.tools?.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        strict: tool.strict
      }
    })),
    stream: true,
    stream_options: { include_usage: true },
    temperature: request.temperature,
    max_completion_tokens: request.maxOutputTokens,
    response_format: request.responseFormat ? toChatResponseFormat(request.responseFormat) : undefined,
    reasoning_effort: request.reasoning?.effort,
    verbosity: request.verbosity,
    metadata: request.metadata
  });
}

export function toChatMessagesFromConversation(items: ConversationItem[]) {
  const chatMessages: Array<Record<string, unknown>> = [];

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;

    if (isAssistantOutputItem(item)) {
      const assistantItems = [item];
      const modelCallId = item.modelCallId;

      while (
        modelCallId !== null &&
        isAssistantOutputItem(items[index + 1]) &&
        items[index + 1]?.modelCallId === modelCallId
      ) {
        assistantItems.push(items[index + 1]!);
        index += 1;
      }

      chatMessages.push(toChatAssistantMessage(assistantItems));
      continue;
    }

    if (item.kind === "function_call_output") {
      chatMessages.push({
        role: "tool",
        tool_call_id: item.toolCallId ?? "",
        content: item.toolOutput ?? ""
      });
      continue;
    }

    if (item.kind === "message") {
      chatMessages.push({
        role: item.role,
        content: item.content ?? ""
      });
    }
  }

  return chatMessages;
}

export function toChatMessages(input: ModelInput[]) {
  const messages: Array<Record<string, unknown>> = [];
  let pendingToolCalls: Array<Record<string, unknown>> = [];

  const flushToolCalls = () => {
    if (pendingToolCalls.length === 0) {
      return;
    }

    messages.push({
      role: "assistant",
      content: null,
      tool_calls: pendingToolCalls
    });
    pendingToolCalls = [];
  };

  for (const item of input) {
    if (item.type === "function_call_output") {
      flushToolCalls();
      messages.push({
        role: "tool",
        tool_call_id: item.callId,
        content: item.output
      });
      continue;
    }

    if (item.type === "function_call") {
      pendingToolCalls.push({
        id: item.callId,
        type: "function",
        function: {
          name: item.name,
          arguments: item.arguments
        }
      });
      continue;
    }

    if (item.type === "reasoning") {
      continue;
    }

    flushToolCalls();
    messages.push({
      role: item.role,
      content: item.content
    });
  }

  flushToolCalls();
  return messages;
}

function toResponsesTextConfig(responseFormat: NonNullable<ModelCallRequest["responseFormat"]>) {
  if (responseFormat.type === "text") {
    return { format: { type: "text" } };
  }

  return {
    format: {
      type: "json_schema",
      name: responseFormat.name,
      schema: responseFormat.schema,
      strict: responseFormat.strict ?? true
    }
  };
}

function toChatResponseFormat(responseFormat: NonNullable<ModelCallRequest["responseFormat"]>) {
  if (responseFormat.type === "text") {
    return { type: "text" };
  }

  return {
    type: "json_schema",
    json_schema: {
      name: responseFormat.name,
      schema: responseFormat.schema,
      strict: responseFormat.strict ?? true
    }
  };
}

function toChatAssistantMessage(items: ConversationItem[]) {
  const content = items
    .map((item) => item.content)
    .filter((content): content is string => !!content)
    .join("");
  const toolCalls = items
    .filter((item) => item.kind === "function_call" && item.toolCallId && item.toolName && item.toolArguments !== undefined)
    .map((item) => ({
      id: item.toolCallId,
      type: "function",
      function: {
        name: item.toolName,
        arguments: item.toolArguments
      }
    }));

  return removeUndefined({
    role: "assistant",
    content: content || (toolCalls.length > 0 ? null : ""),
    tool_calls: toolCalls.length > 0 ? toolCalls : undefined
  });
}

function isAssistantOutputItem(item: ConversationItem | undefined) {
  return item?.kind === "function_call" || (item?.kind === "message" && item.role === "assistant");
}

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined)
  ) as T;
}
