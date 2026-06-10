import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { WorkspaceResolver } from "../customers/workspace.resolver";
import { mapOrder, type OrderResponse } from "./order.mapper";
import type { OrderListQuery } from "./orders.query.dto";

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface OrderListResponse {
  rows: OrderResponse[];
  meta: PageMeta;
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  /** Paginated order list for the seeded workspace, optionally filtered by customer. */
  async list(query: OrderListQuery): Promise<OrderListResponse> {
    const workspaceId = await this.workspace.resolveId();
    const where: Prisma.OrderWhereInput = { workspaceId };
    if (query.customerId) {
      where.customerId = query.customerId;
    }

    const skip = (query.page - 1) * query.limit;

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ orderedAt: "desc" }, { id: "asc" }],
        skip,
        take: query.limit,
        include: { items: true },
      }),
    ]);

    return {
      rows: orders.map(mapOrder),
      meta: {
        page: query.page,
        limit: query.limit,
        total,
        totalPages: Math.ceil(total / query.limit),
      },
    };
  }
}
