import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@mnm/shared-types';
import { z } from 'zod';
import { RequirePermissions } from '../common/auth-context';
import { paginationSchema, ZodQuery } from '../common/zod';
import { AuditService } from './audit.service';

const auditQuery = paginationSchema.extend({
  action: z.string().max(64).optional(),
  actorUserId: z.string().max(32).optional(),
  targetType: z.string().max(32).optional(),
  targetId: z.string().max(64).optional(),
});

@ApiTags('audit')
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.AUDIT_VIEW)
  @ZodQuery(auditQuery)
  list(@Query() query: z.infer<typeof auditQuery>) {
    return this.audit.list(query);
  }
}
