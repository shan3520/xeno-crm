import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, type Customer } from "@prisma/client";

import { PrismaService } from "../prisma/prisma.service";
import { mapOrder, type OrderResponse } from "../orders/order.mapper";
import type { CustomerListQuery } from "./customers.query.dto";
import { WorkspaceResolver } from "./workspace.resolver";

const DAY_MS = 86_400_000;

/**
 * JSON-safe customer row. Decimal -> string (fixed 2dp), timestamps -> ISO 8601 strings,
 * nullable dates -> null. Consumers parse totalSpend as a decimal string, never a float.
 */
export interface CustomerResponse {
  id: string;
  externalId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  attributes: unknown;
  totalSpend: string;
  orderCount: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CustomerListResponse {
  rows: CustomerResponse[];
  meta: PageMeta;
}

export interface CustomerDetailResponse extends CustomerResponse {
  recentOrders: OrderResponse[];
}

export function mapCustomer(c: Customer): CustomerResponse {
  return {
    id: c.id,
    externalId: c.externalId,
    firstName: c.firstName,
    lastName: c.lastName,
    email: c.email,
    phone: c.phone,
    attributes: c.attributes,
    totalSpend: c.totalSpend.toFixed(2),
    orderCount: c.orderCount,
    firstOrderAt: c.firstOrderAt?.toISOString() ?? null,
    lastOrderAt: c.lastOrderAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspace: WorkspaceResolver,
  ) {}

  /** Paginated, filtered customer list for the seeded workspace. */
  async list(query: CustomerListQuery): Promise<CustomerListResponse> {
    const workspaceId = await this.workspace.resolveId();
    const where = this.buildWhere(workspaceId, query);

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

  /** One customer plus their most recent orders (with items). 404 if not found. */
  async getOne(id: string): Promise<CustomerDetailResponse> {
    const workspaceId = await this.workspace.resolveId();
    const customer = await this.prisma.customer.findFirst({
      where: { id, workspaceId },
      include: {
        orders: {
          orderBy: { orderedAt: "desc" },
          take: 10,
          include: { items: true },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException(`Customer ${id} not found`);
    }

    const { orders, ...rest } = customer;
    return {
      ...mapCustomer(rest),
      recentOrders: orders.map(mapOrder),
    };
  }

  private buildWhere(
    workspaceId: string,
    query: CustomerListQuery,
  ): Prisma.CustomerWhereInput {
    const where: Prisma.CustomerWhereInput = { workspaceId };
    const lastOrderAt: Prisma.DateTimeNullableFilter = {};

    if (query.email) {
      where.email = { contains: query.email, mode: "insensitive" };
    }
    if (query.tier) {
      where.attributes = { path: ["tier"], equals: query.tier };
    }
    if (query.minSpend !== undefined) {
      where.totalSpend = { gte: new Prisma.Decimal(query.minSpend) };
    }
    // Lapsed at least N days: last order on/before (now - N days).
    if (query.lastOrderBeforeDays !== undefined) {
      lastOrderAt.lte = new Date(Date.now() - query.lastOrderBeforeDays * DAY_MS);
    }
    // Active within the last N days: last order on/after (now - N days).
    if (query.lastOrderAfterDays !== undefined) {
      lastOrderAt.gte = new Date(Date.now() - query.lastOrderAfterDays * DAY_MS);
    }
    if (lastOrderAt.lte !== undefined || lastOrderAt.gte !== undefined) {
      where.lastOrderAt = lastOrderAt;
    }

    return where;
  }
}
