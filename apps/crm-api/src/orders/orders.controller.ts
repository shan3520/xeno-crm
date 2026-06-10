import { Controller, Get, Query } from "@nestjs/common";

import { OrderListQueryDto } from "./orders.query.dto";
import { OrdersService, type OrderListResponse } from "./orders.service";

@Controller("orders")
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  /** GET /orders — paginated, optional ?customerId filter. */
  @Get()
  list(@Query() query: OrderListQueryDto): Promise<OrderListResponse> {
    return this.orders.list(query);
  }
}
