import { Controller, Get, Param, Query } from "@nestjs/common";

import { CustomerListQueryDto } from "./customers.query.dto";
import {
  CustomersService,
  type CustomerDetailResponse,
  type CustomerListResponse,
} from "./customers.service";

@Controller("customers")
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  /** GET /customers — paginated, with email/tier/recency/spend filters. */
  @Get()
  list(@Query() query: CustomerListQueryDto): Promise<CustomerListResponse> {
    return this.customers.list(query);
  }

  /** GET /customers/:id — one customer with recent orders. */
  @Get(":id")
  getOne(@Param("id") id: string): Promise<CustomerDetailResponse> {
    return this.customers.getOne(id);
  }
}
