import { Injectable } from "@nestjs/common";

import { PrismaService } from "../prisma/prisma.service";

/**
 * Single-workspace system: every request operates on the one seeded "Looms" workspace.
 * The API takes no workspace param — this resolves and memoizes its id internally.
 */
@Injectable()
export class WorkspaceResolver {
  private cachedId: string | null = null;

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve the seeded workspace id, caching after the first lookup. */
  async resolveId(): Promise<string> {
    if (this.cachedId !== null) return this.cachedId;
    const workspace = await this.prisma.workspace.findFirstOrThrow({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    this.cachedId = workspace.id;
    return workspace.id;
  }
}
