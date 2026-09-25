import { ParticipantBusyError } from '../common/domain-error';
import type { CallStore } from './call-store';
import { isLive, type CallSession, type CallStatus, type NewRingingCall } from './call.types';

export class MemoryCallStore implements CallStore {
  private sessions: CallSession[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  createRinging(input: NewRingingCall): Promise<{ session: CallSession; created: boolean }> {
    return this.exclusive(async () => {
      const existing = this.sessions.find(
        (session) => session.callerId === input.callerId && session.startIdempotencyKey === input.idempotencyKey,
      );
      if (existing) return { session: existing, created: false };

      const busy = this.sessions.some(
        (session) =>
          isLive(session.status) &&
          [session.callerId, session.calleeId].some((id) => id === input.callerId || id === input.calleeId),
      );
      if (busy) throw new ParticipantBusyError();

      const session: CallSession = {
        callId: input.callId,
        contextType: input.contextType,
        contextId: input.contextId,
        callerId: input.callerId,
        calleeId: input.calleeId,
        roomName: input.roomName,
        status: 'ringing',
        inviteDeliveryCount: 0,
        startIdempotencyKey: input.idempotencyKey,
        initiatedAt: new Date().toISOString(),
        expiresAt: input.expiresAt,
        answeredAt: null,
        connectedAt: null,
        endedAt: null,
        endReason: null,
      };
      this.sessions.push(session);
      return { session, created: true };
    });
  }

  findForParticipant(callId: string, userId: string): Promise<CallSession | null> {
    return this.exclusive(async () => this.participant(callId, userId));
  }

  findActiveForUser(userId: string): Promise<CallSession | null> {
    return this.exclusive(async () => {
      const matches = this.sessions
        .filter((session) => isLive(session.status) && (session.callerId === userId || session.calleeId === userId))
        .sort((a, b) => b.initiatedAt.localeCompare(a.initiatedAt));
      return matches[0] ? this.clone(matches[0]) : null;
    });
  }

  listLive(): Promise<CallSession[]> {
    return this.exclusive(async () => this.sessions.filter((session) => isLive(session.status)).map((session) => this.clone(session)));
  }

  transition(
    callId: string,
    from: CallStatus[],
    to: CallStatus,
    reason: string | null,
    _actorId: string | null,
  ): Promise<CallSession | null> {
    return this.exclusive(async () => {
      const session = this.sessions.find((row) => row.callId === callId && from.includes(row.status));
      if (!session) return null;
      session.status = to;
      if (reason) session.endReason = reason;
      if (to === 'answered') session.answeredAt = session.answeredAt ?? new Date().toISOString();
      if (to === 'declined' || to === 'missed' || to === 'cancelled' || to === 'ended' || to === 'failed') {
        session.endedAt = session.endedAt ?? new Date().toISOString();
      }
      return this.clone(session);
    });
  }

  markJoined(callId: string, userId: string, participantCount: number): Promise<CallSession | null> {
    const next: CallStatus = participantCount >= 2 ? 'active' : 'connecting';
    return this.exclusive(async () => {
      const session = this.participant(callId, userId);
      if (!session || !['answered', 'connecting', 'active'].includes(session.status)) return null;
      const stored = this.sessions.find((row) => row.callId === callId);
      if (!stored) return null;
      stored.status = next;
      if (next === 'active') stored.connectedAt = stored.connectedAt ?? new Date().toISOString();
      return this.clone(stored);
    });
  }

  markLeft(callId: string, userId: string): Promise<CallSession | null> {
    return this.exclusive(async () => {
      const session = this.sessions.find(
        (row) =>
          row.callId === callId &&
          (row.callerId === userId || row.calleeId === userId) &&
          ['answered', 'connecting', 'active'].includes(row.status),
      );
      if (!session) return null;
      session.status = 'ended';
      session.endReason = 'participant_disconnected';
      session.endedAt = session.endedAt ?? new Date().toISOString();
      return this.clone(session);
    });
  }

  failRinging(callId: string, reason: string): Promise<void> {
    return this.transition(callId, ['ringing'], 'failed', reason, null).then(() => undefined);
  }

  setInviteCount(callId: string, count: number): Promise<void> {
    return this.exclusive(async () => {
      const session = this.sessions.find((row) => row.callId === callId);
      if (session) session.inviteDeliveryCount = count;
    });
  }

  expireUnanswered(): Promise<CallSession[]> {
    return this.exclusive(async () => {
      const now = Date.now();
      const expired: CallSession[] = [];
      for (const session of this.sessions) {
        const unanswered = (session.status === 'ringing' || session.status === 'connecting') && !session.answeredAt;
        if (unanswered && Date.parse(session.expiresAt) <= now) {
          session.status = 'missed';
          session.endReason = 'ring_timeout';
          session.endedAt = new Date().toISOString();
          expired.push(this.clone(session));
        }
      }
      return expired;
    });
  }

  expireForTest(callId: string): void {
    const session = this.sessions.find((row) => row.callId === callId);
    if (!session) throw new Error(`No call ${callId}`);
    session.expiresAt = new Date(Date.now() - 1000).toISOString();
  }

  purgeTerminal(retentionDays: number): Promise<void> {
    return this.exclusive(async () => {
      const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
      this.sessions = this.sessions.filter((session) => {
        if (!session.endedAt) return true;
        return Date.parse(session.endedAt) >= cutoff;
      });
    });
  }

  private participant(callId: string, userId: string): CallSession | null {
    const session = this.sessions.find(
      (row) => row.callId === callId && (row.callerId === userId || row.calleeId === userId),
    );
    return session ? this.clone(session) : null;
  }

  private clone(session: CallSession): CallSession {
    return { ...session };
  }

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = this.chain.then(work, work);
    this.chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
