import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { WorkspaceResolver } from "../customers/workspace.resolver";
import { PrismaService } from "../prisma/prisma.service";
import type {
  AppendMessagesDto,
  CreateAiTaskLogDto,
  CreateThreadDto,
} from "./chat.dto";

/**
 * Conversation + AI-audit persistence for the single seeded workspace. Pure writes/reads over
 * ChatThread / ChatMessage / AiTaskLog — no AI logic here. The CRM is the sole DB writer; the
 * web AI route calls these endpoints rather than ever touching Prisma itself.
 */
@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  /** Create a new conversation thread. */
  async createThread(dto: CreateThreadDto): Promise<{
    id: string;
    title: string | null;
    createdAt: string;
  }> {
    const workspaceId = await this.workspace.resolveId();
    const thread = await this.prisma.chatThread.create({
      data: { workspaceId, title: dto.title ?? null },
      select: { id: true, title: true, createdAt: true },
    });
    return { ...thread, createdAt: thread.createdAt.toISOString() };
  }

  /** Load a thread with its messages in chronological order. 404 if not in this workspace. */
  async getThread(id: string): Promise<{
    id: string;
    title: string | null;
    messages: Array<{ id: string; role: string; content: unknown; createdAt: string }>;
  }> {
    const workspaceId = await this.workspace.resolveId();
    const thread = await this.prisma.chatThread.findFirst({
      where: { id, workspaceId },
      select: {
        id: true,
        title: true,
        messages: {
          orderBy: { createdAt: "asc" },
          select: { id: true, role: true, content: true, createdAt: true },
        },
      },
    });
    if (!thread) throw new NotFoundException(`Chat thread ${id} not found`);
    return {
      id: thread.id,
      title: thread.title,
      messages: thread.messages.map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt.toISOString(),
      })),
    };
  }

  /** Append one or more messages to a thread (idempotency is the caller's concern). */
  async appendMessages(
    threadId: string,
    dto: AppendMessagesDto,
  ): Promise<{ ok: true; count: number }> {
    const workspaceId = await this.workspace.resolveId();
    const thread = await this.prisma.chatThread.findFirst({
      where: { id: threadId, workspaceId },
      select: { id: true },
    });
    if (!thread) throw new NotFoundException(`Chat thread ${threadId} not found`);

    await this.prisma.chatMessage.createMany({
      data: dto.messages.map((m) => ({
        threadId,
        role: m.role,
        content: m.content as Prisma.InputJsonValue,
      })),
    });
    return { ok: true, count: dto.messages.length };
  }

  /** Record one AI tool invocation in the audit log (model, latency, tokens if available). */
  async writeAiTaskLog(dto: CreateAiTaskLogDto): Promise<{ id: string }> {
    const workspaceId = await this.workspace.resolveId();
    const row = await this.prisma.aiTaskLog.create({
      data: {
        workspaceId,
        kind: dto.kind,
        model: dto.model,
        latencyMs: dto.latencyMs ?? null,
        inputTokens: dto.inputTokens ?? null,
        outputTokens: dto.outputTokens ?? null,
        input: (dto.input ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        output: (dto.output ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    return row;
  }
}
