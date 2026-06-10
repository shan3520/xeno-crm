import { Body, Controller, Get, Param, Post } from "@nestjs/common";

import {
  AppendMessagesDto,
  CreateAiTaskLogDto,
  CreateThreadDto,
} from "./chat.dto";
import { ChatService } from "./chat.service";

/**
 * Thin persistence surface for the AI console: thread + message storage and the AiTaskLog
 * audit trail. The web /api/chat route calls these so the AI never writes to the DB directly.
 */
@Controller()
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  /** POST /chat-threads — start a conversation. */
  @Post("chat-threads")
  createThread(@Body() dto: CreateThreadDto) {
    return this.chat.createThread(dto);
  }

  /** GET /chat-threads/:id — load a conversation with its messages. */
  @Get("chat-threads/:id")
  getThread(@Param("id") id: string) {
    return this.chat.getThread(id);
  }

  /** POST /chat-threads/:id/messages — append message(s) to a thread. */
  @Post("chat-threads/:id/messages")
  appendMessages(@Param("id") id: string, @Body() dto: AppendMessagesDto) {
    return this.chat.appendMessages(id, dto);
  }

  /** POST /ai-task-logs — record one AI tool call (model, latency, tokens). */
  @Post("ai-task-logs")
  writeAiTaskLog(@Body() dto: CreateAiTaskLogDto) {
    return this.chat.writeAiTaskLog(dto);
  }
}
