import { Module } from "@nestjs/common";

import { CustomersModule } from "../customers/customers.module";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

/**
 * Chat: persists the AI console conversation (ChatThread/ChatMessage) and the per-tool-call
 * AiTaskLog. Imports CustomersModule for the single-workspace resolver. No AI logic lives in
 * crm-api — the model runs in the web /api/chat route and posts its structured results here.
 */
@Module({
  imports: [CustomersModule],
  controllers: [ChatController],
  providers: [ChatService],
})
export class ChatModule {}
