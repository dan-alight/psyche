import type { FastifyInstance } from "fastify";
import { WebSocket } from "ws";
import {
  conversationRecentModelCallsQuerySchema,
  conversationStreamQuerySchema,
} from "@psyche/shared";

import {
  type ConversationManager,
  getConversationManager,
} from "@/conversations/ConversationManager";

export type ConversationRouteOptions = {
  manager?: ConversationManager;
};

export async function registerConversationRoutes(
  app: FastifyInstance,
  options: ConversationRouteOptions = {},
) {
  const manager = options.manager ?? getConversationManager();

  app.get("/conversation/model-calls", async (request) => {
    const query = conversationRecentModelCallsQuerySchema.parse(request.query);
    const modelCalls = await manager.listRecentModelCallsWithTranscriptItems({
      limit: query.limit,
    });

    return { modelCalls };
  });

  app.get(
    "/conversation/stream",
    { websocket: true },
    async (socket, request) => {
      let subscription:
        | Awaited<ReturnType<ConversationManager["subscribeAfter"]>>
        | undefined;
      let socketClosed = false;

      socket.on("close", () => {
        socketClosed = true;
        subscription?.close();
      });

      try {
        const query = conversationStreamQuerySchema.parse(request.query);

        subscription = await manager.subscribeAfter({
          afterTranscriptItemId: query.afterTranscriptItemId,
        });

        if (socketClosed || socket.readyState !== WebSocket.OPEN) {
          subscription.close();
          return;
        }

        for await (const event of subscription) {
          if (socket.readyState !== WebSocket.OPEN) {
            subscription.close();
            break;
          }

          socket.send(JSON.stringify(event));
        }
      } catch (error) {
        request.log.error({ error }, "Conversation stream failed");

        if (socket.readyState === WebSocket.OPEN) {
          socket.close(1011, "Conversation stream failed");
        }
      } finally {
        subscription?.close();

        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        }
      }
    },
  );
}
