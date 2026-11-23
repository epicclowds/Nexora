import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../common/auth-context';
import { HealthService } from './health.service';

@ApiTags('health')
@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly health: HealthService) {}

  /** Liveness: the process is running and able to serve HTTP. */
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  /** Readiness: database and Redis are reachable. Returns 503 otherwise. */
  @Get('ready')
  async ready() {
    const report = await this.health.report();
    if (report.status !== 'ok') {
      // Do not expose internal error strings on the public readiness probe.
      throw new ServiceUnavailableException({
        code: 'NOT_READY',
        message: `database=${report.components.database.state}, redis=${report.components.redis.state}`,
      });
    }
    return { status: report.status, version: report.version, uptimeSeconds: report.uptimeSeconds };
  }
}
