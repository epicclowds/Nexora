import { Controller, Get, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { hasPermission } from '@mnm/shared-types';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service';
import { type AuthenticatedUser, CurrentUser } from '../common/auth-context';
import { EVENT_PERMISSION, type RealtimeEvent, RealtimeService } from './realtime.service';

const KEEPALIVE_MS = 25_000;
const REVALIDATE_MS = 60_000;

/**
 * Server-Sent Events stream for live dashboard updates. SSE travels through the
 * dashboard's same-origin /api proxy, so no extra port or upgrade handling is
 * needed (see docs/architecture/realtime.md).
 */
@ApiTags('realtime')
@SkipThrottle()
@Controller('events')
export class RealtimeController {
  constructor(
    private readonly realtime: RealtimeService,
    private readonly auth: AuthService,
  ) {}

  @Get()
  stream(@CurrentUser() user: AuthenticatedUser, @Req() req: Request, @Res() res: Response): void {
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    // no-transform keeps intermediaries (incl. compression) from buffering the stream.
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(`retry: 5000\nevent: ready\ndata: {}\n\n`);

    let permissions = user.permissions;
    const send = (event: RealtimeEvent) => {
      if (hasPermission(permissions, EVENT_PERMISSION[event.type])) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    };
    const unsubscribe = this.realtime.subscribe(send);
    const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), KEEPALIVE_MS);

    // Long-lived streams outlive the access token: re-check the session so
    // logout, disabling or permission changes take effect.
    const revalidate = setInterval(() => {
      void this.auth.authenticateSession(user.sessionId, user.id).then((current) => {
        if (!current) close();
        else permissions = current.permissions;
      });
    }, REVALIDATE_MS);

    const close = () => {
      clearInterval(keepAlive);
      clearInterval(revalidate);
      unsubscribe();
      res.end();
    };
    req.on('close', close);
  }
}
