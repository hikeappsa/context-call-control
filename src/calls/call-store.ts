import type { CallSession, CallStatus, NewRingingCall } from './call.types';

export interface CallStore {
  createRinging(input: NewRingingCall): Promise<{ session: CallSession; created: boolean }>;
  findForParticipant(callId: string, userId: string): Promise<CallSession | null>;
  findActiveForUser(userId: string): Promise<CallSession | null>;
  listLive(): Promise<CallSession[]>;
  transition(
    callId: string,
    from: CallStatus[],
    to: CallStatus,
    reason: string | null,
    actorId: string | null,
  ): Promise<CallSession | null>;
  markJoined(callId: string, userId: string, participantCount: number): Promise<CallSession | null>;
  markLeft(callId: string, userId: string): Promise<CallSession | null>;
  failRinging(callId: string, reason: string): Promise<void>;
  setInviteCount(callId: string, count: number): Promise<void>;
  expireUnanswered(): Promise<CallSession[]>;
  purgeTerminal(retentionDays: number): Promise<void>;
}

export const CALL_STORE = Symbol('CALL_STORE');
