export type MediaRoomEvent =
  | {
      type: 'participant_joined' | 'participant_left';
      roomName: string;
      participantId: string;
      participantCount?: number;
    }
  | { type: 'ignored' };

export interface MediaWebhookVerifier {
  verify(rawBody: string, authorization: string | undefined): Promise<MediaRoomEvent>;
}

export const MEDIA_WEBHOOK_VERIFIER = Symbol('MEDIA_WEBHOOK_VERIFIER');
