import { Controller, Headers, Inject, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { CallService } from '../calls/call.service';
import { ApiError } from '../common/api-error';
import { MEDIA_WEBHOOK_VERIFIER, type MediaWebhookVerifier } from '../ports/media-webhook';

interface WebhookRequest {
  rawBody?: Buffer;
}

const ROOM_PREFIX = 'call-';
const CALL_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Controller('webhooks')
export class MediaWebhookController {
  constructor(
    private readonly calls: CallService,
    @Inject(MEDIA_WEBHOOK_VERIFIER) private readonly verifier: MediaWebhookVerifier,
  ) {}

  @Post('media')
  async receive(@Req() request: RawBodyRequest<WebhookRequest>, @Headers('authorization') authorization?: string) {
    if (!request.rawBody) throw ApiError.unauthorized('WEBHOOK_REJECTED', 'The media event could not be verified.');
    let event;
    try {
      event = await this.verifier.verify(request.rawBody.toString('utf8'), authorization);
    } catch {
      throw ApiError.unauthorized('WEBHOOK_REJECTED', 'The media event could not be verified.');
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
