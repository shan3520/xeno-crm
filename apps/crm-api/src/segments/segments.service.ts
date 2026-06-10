import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Segment } from "@prisma/client";
import {
  validateSegmentDefinition,
  type SegmentDefinition,
  type SegmentOrigin,
} from "@xeno/shared";

import {
  mapCustomer,
  type CustomerResponse,
  type PageMeta,
} from "../customers/customers.service";
import { WorkspaceResolver } from "../customers/workspace.resolver";
import { PrismaService } from "../prisma/prisma.service";
import {
  compileSegmentDefinition,
  SegmentCompileError,
} from "./compiler/segment-compiler";
import type {
  SegmentCreateDto,
  SegmentMembersQuery,
  SegmentPreviewDto,
} from "./segments.dto";

/** JSON-safe segment row. `definition` is the raw DSL so it can be recompiled later. */
export interface SegmentResponse {
  id: string;
  name: string;
  description: string | null;
  definition: unknown;
  origin: SegmentOrigin;
  lastEvaluatedCount: number | null;
  lastEvaluatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SegmentPreviewResponse {
  count: number;
  sample: CustomerResponse[];
}

export interface SegmentMembersResponse {
  rows: CustomerResponse[];
  meta: PageMeta;
}

function mapSegment(s: Segment): SegmentResponse {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    definition: s.definition,
    origin: s.origin as SegmentOrigin,
    lastEvaluatedCount: s.lastEvaluatedCount,
    lastEvaluatedAt: s.lastEvaluatedAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

@Injectable()
export class SegmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  /** Validate + compile + count + 10-row sample, WITHOUT persisting. */
  async preview(dto: SegmentPreviewDto): Promise<SegmentPreviewResponse> {
    const workspaceId = await this.workspace.resolveId();
    const where = this.compileScoped(workspaceId, dto.definition);

    const [count, sample] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ lastOrderAt: "desc" }, { id: "asc" }],
        take: 10,
      }),
    ]);

    return { count, sample: sample.map(mapCustomer) };
  }

  /** Validate + compile + count, then persist the segment with its raw definition. */
  async create(dto: SegmentCreateDto): Promise<SegmentResponse> {
    const workspaceId = await this.workspace.resolveId();
    const where = this.compileScoped(workspaceId, dto.definition);

    const count = await this.prisma.customer.count({ where });

    const segment = await this.prisma.segment.create({
      data: {
        workspaceId,
        name: dto.name,
        description: dto.description ?? null,
        definition: dto.definition as unknown as Prisma.InputJsonValue,
        origin: dto.origin,
        lastEvaluatedCount: count,
        lastEvaluatedAt: new Date(),
      },
    });

    return mapSegment(segment);
  }

  /** List all segments for the seeded workspace, newest first. */
  async list(): Promise<SegmentResponse[]> {
    const workspaceId = await this.workspace.resolveId();
    const segments = await this.prisma.segment.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
    });
    return segments.map(mapSegment);
  }

  /** One segment by id. 404 if not found. */
  async getOne(id: string): Promise<SegmentResponse> {
    return mapSegment(await this.loadSegment(id));
  }

  /** Paginated audience for a stored segment — recompiles its definition each call. */
  async members(
    id: string,
    query: SegmentMembersQuery,
  ): Promise<SegmentMembersResponse> {
    const workspaceId = await this.workspace.resolveId();
    const segment = await this.loadSegment(id);

    const parsed = validateSegmentDefinition(segment.definition);
    if (!parsed.ok) {
      throw new BadRequestException(`Stored segment definition is invalid: ${parsed.error}`);
    }
    const where = this.compileScoped(workspaceId, parsed.value);

    const skip = (query.page - 1) * query.limit;
    const [total, customers] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        orderBy: [{ lastOrderAt: "desc" }, { id: "asc" }],
        skip,
        take: query.limit,
      }),
    ]);

    return {
      rows: customers.map(mapCustomer),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }

  // ─── Helpers ──────────────────────────────────────────────────────

  private async loadSegment(id: string): Promise<Segment> {
    const workspaceId = await this.workspace.resolveId();
    const segment = await this.prisma.segment.findFirst({ where: { id, workspaceId } });
    if (!segment) {
      throw new NotFoundException(`Segment ${id} not found`);
    }
    return segment;
  }

  /**
   * Compile a definition to a Prisma where, scoped to the workspace. SegmentCompileError
   * (whitelist / operator-value violations) surfaces as a typed 400 — before any DB call
   * inside the caller, since count/findMany run after this returns.
   */
  private compileScoped(
    workspaceId: string,
    definition: SegmentDefinition,
  ): Prisma.CustomerWhereInput {
    try {
      const compiled = compileSegmentDefinition(definition);
      return { AND: [{ workspaceId }, compiled] };
    } catch (err) {
      if (err instanceof SegmentCompileError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }
  }
}
