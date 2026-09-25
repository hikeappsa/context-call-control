import { Injectable } from '@nestjs/common';
import { WebhookReceiver } from 'livekit-server-sdk';
import { requiredEnv } from '../config/env';
import type { MediaRoomEvent, MediaWebhookVerifier } from '../ports/media-webhook';

@Injectable()
export class LiveKitWebhookVerifier implements MediaWebhookVerifier {
  async verify(rawBody: string, authorization: string | undefined): Promise<MediaRoomEvent> {
    const event = await new WebhookReceiver(requiredEnv('LIVEKIT_API_KEY'), requiredEnv('LIVEKIT_API_SECRET')).receive(
      rawBody,
      authorization,
    );
    const roomName = event.room?.name;
    const participantId = event.participant?.identity;
    if (!roomName || !participantId) return { type: 'ignored' };
    if (event.event === 'participant_joined') {
      return {
        type: 'participant_joined',
        roomName,
        participantId,
        participantCount: event.room?.numParticipants,
      };
    }
    if (event.event === 'participant_left') {
      return { type: 'participant_left', roomName, participantId };
    }
    return { type: 'ignored' };
  }
}
