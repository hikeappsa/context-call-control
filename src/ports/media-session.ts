export interface MediaSession {
  serverUrl(): string;
  issueToken(roomName: string, userId: string, displayName: string): Promise<string>;
  closeRoom(roomName: string): Promise<void>;
}

export const MEDIA_SESSION = Symbol('MEDIA_SESSION');
