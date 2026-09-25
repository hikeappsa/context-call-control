import { Controller, Headers, Inject, Post, Req, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { CallService } from '../calls/call.service';
import { MEDIA_WEBHOOK_VERIFIER, type MediaWebhookVerifier } from '../ports/media-webhook';

const ROOM_PREFIX = 'call-';
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('webhooks')
export class MediaWebhookController {
  constructor(
    private readonly calls: CallService,
    @Inject(MEDIA_WEBHOOK_VERIFIER) private readonly verifier: MediaWebhookVerifier,
  ) {}

  @Post('media')
  async receive(@Req() request: RawBodyRequest<Request>, @Headers('authorization') authorization?: string) {
    if (!request.rawBody) throw new UnauthorizedException('Raw webhook body unavailable');
    let event;
    try {
      event = await this.verifier.verify(request.rawBody.toString('utf8'), authorization);
    } catch {
      throw new UnauthorizedException('Invalid webhook signature');
    }
    if (event.type === 'ignored') return { received: true };
    const callId = event.roomName.startsWith(ROOM_PREFIX) ? event.roomName.slice(ROOM_PREFIX.length) : '';
    if (!CALL_ID.test(callId)) return { received: true };
    if (event.type === 'participant_joined') {
      await this.calls.markParticipantJoined(callId, event.participantId, event.participantCount);
    }
    if (event.type === 'participant_left') {
      await this.calls.markParticipantLeft(callId, event.participantId);
    }
    return { received: true };
  }
}
