import {
  Controller,
  Get,
  Inject,
  Param,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { SessionAuthGuard } from '../auth/session-auth.guard.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { auditQuery, type AuditQuery } from '../audit/audit.schemas.js';
import { ReportingService } from './reporting.service.js';
import { reportParams, reportQuery, type ReportQuery } from './reporting.schemas.js';
import { reportCsv } from './report.csv.js';
function actor(req: AuthenticatedRequest) {
  if (!req.auth) throw new UnauthorizedException();
  return req.auth.userId;
}
type Params = { workspaceId: string; projectId?: string };
@Controller(['workspaces/:workspaceId', 'workspaces/:workspaceId/projects/:projectId'])
@UseGuards(SessionAuthGuard)
export class ReportingController {
  constructor(@Inject(ReportingService) private readonly service: ReportingService) {}
  @Get(['analytics', 'report'])
  report(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(reportParams)) p: Params,
    @Query(new ZodValidationPipe(reportQuery)) query: ReportQuery,
  ) {
    return this.service.report(p.workspaceId, actor(req), query, p.projectId);
  }
  @Get('report.csv')
  async csv(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(reportParams)) p: Params,
    @Query(new ZodValidationPipe(reportQuery)) query: ReportQuery,
    @Res({ passthrough: true }) response: ServerResponse,
  ) {
    const report = await this.service.report(p.workspaceId, actor(req), query, p.projectId);
    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${p.projectId ? 'project' : 'workspace'}-report.csv"`,
    );
    return reportCsv(report);
  }
}
@Controller('workspaces/:workspaceId/audit')
@UseGuards(SessionAuthGuard)
export class AuditController {
  constructor(@Inject(ReportingService) private readonly service: ReportingService) {}
  @Get()
  audit(
    @Req() req: AuthenticatedRequest,
    @Param(new ZodValidationPipe(reportParams)) p: Params,
    @Query(new ZodValidationPipe(auditQuery)) query: AuditQuery,
  ) {
    return this.service.audit(p.workspaceId, actor(req), query);
  }
}
