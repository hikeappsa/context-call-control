import { Injectable, Logger } from '@nestjs/common';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { requiredEnv, tokenTtlSeconds } from '../config/env';
import type { MediaSession } from '../ports/media-session';

@Injectable()
export class LiveKitMediaSession implements MediaSession {
  private readonly logger = new Logger(LiveKitMediaSession.name);

  serverUrl(): string {
    return requiredEnv('LIVEKIT_URL');
  }

  async issueToken(roomName: string, userId: string, displayName: string): Promise<string> {
    const ttlSeconds = tokenTtlSeconds();
    const token = new AccessToken(requiredEnv('LIVEKIT_API_KEY'), requiredEnv('LIVEKIT_API_SECRET'), {
      identity: userId,
      name: displayName,
      ttl: `${ttlSeconds}s`,
    });
    token.addGrant({
      room: roomName,
      roomJoin: true,
      canPublish: true,
      canPublishSources: [TrackSource.MICROPHONE],
      canSubscribe: true,
      canPublishData: false,
      canUpdateOwnMetadata: false,
    });
    return token.toJwt();
  }

  async closeRoom(roomName: string): Promise<void> {
    try {
      await new RoomServiceClient(this.apiUrl(), requiredEnv('LIVEKIT_API_KEY'), requiredEnv('LIVEKIT_API_SECRET'), {
        requestTimeout: 5_000,
      }).deleteRoom(roomName);
    } catch (error) {
      this.logger.error(`Unable to close room ${roomName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private apiUrl(): string {
    const configured = process.env.LIVEKIT_API_URL?.trim() || requiredEnv('LIVEKIT_URL');
    return configured.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
  }
}
