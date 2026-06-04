import type { ModelCallRequest, ModelInput, ModelTool } from "@/modelClients/types";

export function toResponsesInput(input: ModelInput[]) {
  return input.map((item) => {
    if ("callId" in item) {
      return {
        type: "function_call_output",
        call_id: item.callId,
        output: item.output
      };
    }

    return {
      type: "message",
      role: item.role,
      content: [{ type: "input_text", text: item.content }]
    };
  });
}

export function toResponsesTools(tools: ModelTool[] | undefined) {
  return tools?.map((tool) => ({
    type: "function",
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  }));
}

export function toResponsesCreateEvent(request: ModelCallRequest) {
  return removeUndefined({
    type: "response.create",
    model: request.model,
    instructions: request.instructions,
    input: toResponsesInput(request.input),
    tools: toResponsesTools(request.tools),
    previous_response_id: request.previousResponseId,
    store: request.store ?? false,
    temperature: request.temperature,
    max_output_tokens: request.maxOutputTokens,
    text: request.responseFormat ? toResponsesTextConfig(request.responseFormat) : undefined,
    reasoning: request.reasoning,
    verbosity: request.verbosity,
    metadata: request.metadata
  });
}

export function toChatCompletionsBody(request: ModelCallRequest) {
  const messages: Array<Record<string, unknown>> = request.input.flatMap((item): Array<Record<string, unknown>> => {
    if ("callId" in item) {
      return [{
        role: "tool",
        tool_call_id: item.callId,
        content: item.output
      }];
    }

    return [{
      role: item.role,
      content: item.content
    }];
  });

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
        parameters: tool.parameters
      }
    })),
    stream: true,
    temperature: request.temperature,
    max_completion_tokens: request.maxOutputTokens,
    response_format: request.responseFormat ? toChatResponseFormat(request.responseFormat) : undefined,
    reasoning_effort: request.reasoning?.effort,
    verbosity: request.verbosity,
    metadata: request.metadata
  });
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

function removeUndefined<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter((entry) => entry[1] !== undefined)
  ) as T;
}
