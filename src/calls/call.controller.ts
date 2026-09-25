import { Body, Controller, Get, Headers, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { CurrentUser } from '../auth/current-user.decorator';
import { DevJwtGuard } from '../auth/dev-jwt.guard';
import { opaqueId } from '../config/env';
import type { AuthUser } from '../ports/identity';
import { CallService } from './call.service';

const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('calls')
@UseGuards(DevJwtGuard)
export class CallController {
  constructor(private readonly calls: CallService) {}

  @Get('availability')
  availability(
    @CurrentUser() user: AuthUser,
    @Query('contextType') contextType: unknown,
    @Query('contextId') contextId: unknown,
  ) {
    const context = readContext(contextType, contextId);
    return this.calls.availability(user, context.contextType, context.contextId);
  }

  @Post()
  start(
    @CurrentUser() user: AuthUser,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: { contextType?: unknown; contextId?: unknown },
  ) {
    const context = readContext(body?.contextType, body?.contextId);
    const key = idempotencyKey?.trim() ?? '';
    if (!key || key.length > 100) {
      throw ApiError.badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header and try the call again.');
    }
    return this.calls.start(user, context.contextType, context.contextId, key);
  }

  @Get('active')
  active(@CurrentUser() user: AuthUser) {
    return this.calls.active(user);
  }

  @Post(':callId/accept')
  accept(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.calls.accept(user, readCallId(callId));
  }

  @Post(':callId/decline')
  decline(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.calls.decline(user.userId, readCallId(callId));
  }

  @Post(':callId/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('callId') callId: string) {
    return this.calls.cancel(user.userId, readCallId(callId));
  }

  @Post(':callId/end')
  end(@CurrentUser() user: AuthUser, @Param('callId') callId: string, @Body() body: { reason?: unknown }) {
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 50) : 'participant_ended';
    return this.calls.end(user.userId, readCallId(callId), reason);
  }
}

function readContext(contextType: unknown, contextId: unknown): { contextType: string; contextId: string } {
  try {
    return {
      contextType: opaqueId(contextType, 'contextType', 64),
      contextId: opaqueId(contextId, 'contextId', 128),
    };
  } catch (error) {
    throw ApiError.badRequest('INVALID_CONTEXT', error instanceof Error ? error.message : 'The context is not valid.');
  }
}

function readCallId(value: string): string {
  if (!CALL_ID.test(value)) throw ApiError.badRequest('INVALID_CALL_ID', 'The call id is not valid.');
  return value;
}
