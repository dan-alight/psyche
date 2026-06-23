import { FormEvent, useEffect, useMemo, useReducer, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import type {
  ConversationLiveEvent,
  ConversationTranscriptItem,
} from "@psyche/shared";

import { Button, Panel } from "@/components/ui";
import styles from "@/features/home/HomePage.module.css";
import {
  conversationStreamUrl,
  listModels,
  listProviders,
  listRecentConversationModelCalls,
  parseConversationLiveEvent,
  startAgentRun,
} from "@/lib/api";

type StreamState = {
  items: ConversationTranscriptItem[];
  liveTextByModelCallId: Map<number, string>;
  status: "connecting" | "open" | "closed" | "error";
  error?: string;
};

type StreamAction =
  | { type: "reset" }
  | { type: "status"; status: StreamState["status"]; error?: string }
  | { type: "event"; event: ConversationLiveEvent };

const initialStreamState: StreamState = {
  items: [],
  liveTextByModelCallId: new Map(),
  status: "closed",
};

export function HomePage() {
  const [providerKey, setProviderKey] = useState("openai");
  const [model, setModel] = useState("");
  const [input, setInput] = useState("");
  const [streamState, dispatchStream] = useReducer(
    streamReducer,
    initialStreamState,
  );
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders,
  });
  const selectedProvider =
    providersQuery.data?.find((provider) => provider.key === providerKey) ??
    providersQuery.data?.[0];
  const modelsQuery = useQuery({
    queryKey: ["models", selectedProvider?.id],
    queryFn: () => listModels(selectedProvider?.id),
    enabled: Boolean(selectedProvider),
  });
  const recentQuery = useQuery({
    queryKey: ["conversation", "model-calls"],
    queryFn: () => listRecentConversationModelCalls(20),
  });
  const runMutation = useMutation({
    mutationFn: startAgentRun,
  });

  useEffect(() => {
    if (!selectedProvider) {
      return;
    }

    setProviderKey(selectedProvider.key);
  }, [selectedProvider]);

  useEffect(() => {
    const firstModel = modelsQuery.data?.[0]?.modelId;
    const hasSelectedModel = modelsQuery.data?.some(
      (modelOption) => modelOption.modelId === model,
    );

    if (firstModel && !hasSelectedModel) {
      setModel(firstModel);
    }
  }, [model, modelsQuery.data]);

  const loadedItems = useMemo(
    () =>
      sortTranscriptItems(
        recentQuery.data?.modelCalls.flatMap(
          (modelCall) => modelCall.transcriptItems,
        ) ?? [],
      ),
    [recentQuery.data],
  );
  const streamStartTranscriptItemId = useMemo(
    () => maxTranscriptItemId(loadedItems),
    [loadedItems],
  );
  const transcriptItems = useMemo(
    () => mergeTranscriptItems(loadedItems, streamState.items),
    [loadedItems, streamState.items],
  );

  useEffect(() => {
    if (!recentQuery.isSuccess) {
      return;
    }

    dispatchStream({ type: "reset" });
    dispatchStream({ type: "status", status: "connecting" });

    const socket = new WebSocket(
      conversationStreamUrl(streamStartTranscriptItemId),
    );

    socket.addEventListener("open", () => {
      dispatchStream({ type: "status", status: "open" });
    });
    socket.addEventListener("message", (event) => {
      try {
        dispatchStream({
          type: "event",
          event: parseConversationLiveEvent(String(event.data)),
        });
      } catch (error) {
        dispatchStream({
          type: "status",
          status: "error",
          error: error instanceof Error ? error.message : "Invalid stream event",
        });
      }
    });
    socket.addEventListener("error", () => {
      dispatchStream({
        type: "status",
        status: "error",
        error: "Conversation stream failed",
      });
    });
    socket.addEventListener("close", () => {
      dispatchStream({ type: "status", status: "closed" });
    });

    return () => {
      socket.close();
    };
  }, [recentQuery.isSuccess, streamStartTranscriptItemId]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedInput = input.trim();

    if (!selectedProvider || !model || !trimmedInput || runMutation.isPending) {
      return;
    }

    setInput("");
    runMutation.mutate({
      providerKey: selectedProvider.key,
      model,
      input: trimmedInput,
    });
  }

  const liveOutputs = [...streamState.liveTextByModelCallId.entries()]
    .filter(([, content]) => content.length > 0)
    .sort(([firstModelCallId], [secondModelCallId]) => (
      firstModelCallId - secondModelCallId
    ));
  const pageError =
    providersQuery.error ??
    modelsQuery.error ??
    recentQuery.error ??
    runMutation.error;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Self-hosted workspace</p>
        <h1>Model interaction</h1>
      </header>

      <Panel className={styles.composer} aria-label="Start agent run">
        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.controls}>
            <label>
              <span>Provider</span>
              <select
                value={selectedProvider?.key ?? providerKey}
                onChange={(event) => setProviderKey(event.target.value)}
              >
                {providersQuery.data?.map((provider) => (
                  <option key={provider.id} value={provider.key}>
                    {provider.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Model</span>
              <select
                value={model}
                onChange={(event) => setModel(event.target.value)}
              >
                {modelsQuery.data?.map((modelOption) => (
                  <option key={modelOption.id} value={modelOption.modelId}>
                    {modelOption.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className={styles.prompt}>
            <span>Prompt</span>
            <textarea
              value={input}
              rows={4}
              onChange={(event) => setInput(event.target.value)}
            />
          </label>

          <div className={styles.actions}>
            <Button
              disabled={
                runMutation.isPending ||
                !selectedProvider ||
                !model ||
                input.trim().length === 0
              }
              type="submit"
            >
              {runMutation.isPending ? "Running" : "Run"}
            </Button>
            <span className={styles.streamStatus}>
              Stream: {streamState.status}
            </span>
          </div>
        </form>
      </Panel>

      {pageError ? <p className={styles.error}>{pageError.message}</p> : null}
      {streamState.error ? (
        <p className={styles.error}>{streamState.error}</p>
      ) : null}

      <div className={styles.transcript} aria-live="polite">
        {transcriptItems.map((item) => (
          <TranscriptRow key={item.id} item={item} />
        ))}
        {liveOutputs.map(([modelCallId, content]) => (
          <div
            key={`live-${modelCallId}`}
            className={`${styles.row} ${styles.assistant}`}
          >
            <div className={styles.role}>Assistant streaming</div>
            <pre>{content}</pre>
          </div>
        ))}
      </div>
    </section>
  );
}

function streamReducer(state: StreamState, action: StreamAction): StreamState {
  if (action.type === "reset") {
    return initialStreamState;
  }

  if (action.type === "status") {
    return {
      ...state,
      status: action.status,
      error: action.error,
    };
  }

  if (action.event.type === "text_delta") {
    const liveTextByModelCallId = new Map(state.liveTextByModelCallId);
    const existing = liveTextByModelCallId.get(action.event.modelCallId) ?? "";

    liveTextByModelCallId.set(
      action.event.modelCallId,
      `${existing}${action.event.delta}`,
    );

    return {
      ...state,
      liveTextByModelCallId,
    };
  }

  const liveTextByModelCallId = new Map(state.liveTextByModelCallId);

  if (
    action.event.item.kind === "assistant_output" &&
    action.event.item.modelCallId !== null
  ) {
    liveTextByModelCallId.delete(action.event.item.modelCallId);
  }

  return {
    ...state,
    items: mergeTranscriptItems(state.items, [action.event.item]),
    liveTextByModelCallId,
  };
}

function TranscriptRow({ item }: { item: ConversationTranscriptItem }) {
  const role =
    item.kind === "user_prompt"
      ? "User"
      : item.kind === "assistant_output"
        ? "Assistant"
        : "Tool call";
  const content =
    item.kind === "function_call"
      ? `${item.toolName ?? "tool"}(${item.toolArguments ?? ""})`
      : item.content;
  const tone =
    item.kind === "user_prompt"
      ? styles.user
      : item.kind === "assistant_output"
        ? styles.assistant
        : styles.tool;

  return (
    <div className={`${styles.row} ${tone}`}>
      <div className={styles.role}>{role}</div>
      <pre>{content}</pre>
    </div>
  );
}

function mergeTranscriptItems(
  first: ConversationTranscriptItem[],
  second: ConversationTranscriptItem[],
) {
  const itemsById = new Map<number, ConversationTranscriptItem>();

  for (const item of [...first, ...second]) {
    itemsById.set(item.id, item);
  }

  return sortTranscriptItems([...itemsById.values()]);
}

function sortTranscriptItems(items: ConversationTranscriptItem[]) {
  return [...items].sort((first, second) => first.id - second.id);
}

function maxTranscriptItemId(items: ConversationTranscriptItem[]) {
  return Math.max(0, ...items.map((item) => item.id));
}
