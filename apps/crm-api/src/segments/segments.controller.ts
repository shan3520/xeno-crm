import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";

import {
  SegmentCreateDto,
  SegmentMembersQueryDto,
  SegmentPreviewDto,
} from "./segments.dto";
import {
  SegmentsService,
  type SegmentMembersResponse,
  type SegmentPreviewResponse,
  type SegmentResponse,
} from "./segments.service";

@Controller("segments")
export class SegmentsController {
  constructor(private readonly segments: SegmentsService) {}

  /** POST /segments/preview — validate + compile + count + sample, no persistence. */
  @Post("preview")
  @HttpCode(200)
  preview(@Body() dto: SegmentPreviewDto): Promise<SegmentPreviewResponse> {
    return this.segments.preview(dto);
  }

  /** POST /segments — persist a segment, caching its evaluated count. */
  @Post()
  create(@Body() dto: SegmentCreateDto): Promise<SegmentResponse> {
    return this.segments.create(dto);
  }

  /** GET /segments — list segments for the workspace. */
  @Get()
  list(): Promise<SegmentResponse[]> {
    return this.segments.list();
  }

  /** GET /segments/:id — one segment. */
  @Get(":id")
  getOne(@Param("id") id: string): Promise<SegmentResponse> {
    return this.segments.getOne(id);
  }

  /** GET /segments/:id/members — paginated compiled audience. */
  @Get(":id/members")
  members(
    @Param("id") id: string,
    @Query() query: SegmentMembersQueryDto,
  ): Promise<SegmentMembersResponse> {
    return this.segments.members(id, query);
  }
}
