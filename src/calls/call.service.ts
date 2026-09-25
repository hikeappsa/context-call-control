import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { ApiError } from '../common/api-error';
import { ContextAccessError } from '../common/domain-error';
import { callsEnabled, retentionDays, ringSeconds } from '../config/env';
import { CONTEXT_AUTHORIZER, type ContextAuthorizer } from '../ports/context-authorizer';
import { MEDIA_SESSION, type MediaSession } from '../ports/media-session';
import type { AuthUser } from '../ports/identity';
import { PUSH_NOTIFIER, type PushNotifier } from '../ports/push-notifier';
import { CALL_STORE, type CallStore } from './call-store';
import { isTerminal, type CallSession, type CallStatus } from './call.types';

@Injectable()
export class CallService {
  private readonly logger = new Logger(CallService.name);

  constructor(
    @Inject(CALL_STORE) private readonly store: CallStore,
    @Inject(CONTEXT_AUTHORIZER) private readonly authorization: ContextAuthorizer,
    @Inject(MEDIA_SESSION) private readonly media: MediaSession,
    @Inject(PUSH_NOTIFIER) private readonly pushes: PushNotifier,
  ) {}

  async availability(user: AuthUser, contextType: string, contextId: string) {
    if (!callsEnabled()) return { available: false, reason: 'FEATURE_DISABLED' };
    try {
      await this.authorization.resolve(user.userId, contextType, contextId);
      return { available: true };
    } catch (error) {
      if (error instanceof ContextAccessError) return { available: false, reason: error.code };
      throw error;
    }
  }

  async start(user: AuthUser, contextType: string, contextId: string, idempotencyKey: string) {
    if (!callsEnabled()) throw ApiError.forbidden('FEATURE_DISABLED', 'Calling is not available right now.');
    const parties = await this.authorization.resolve(user.userId, contextType, contextId);
    const callId = randomUUID();
    const roomName = `call-${callId}`;
    const expiresAt = new Date(Date.now() + ringSeconds() * 1000).toISOString();
    const created = await this.store.createRinging({
      callId,
      contextType: parties.contextType,
      contextId: parties.contextId,
      callerId: parties.callerId,
      calleeId: parties.calleeId,
      roomName,
      expiresAt,
      idempotencyKey,
    });

    if (!created.created) {
      return this.present(created.session, user.userId, parties.calleeName);
    }

    let delivered = 0;
    try {
      delivered = await this.pushes.sendInvite({
        callId: created.session.callId,
        calleeId: parties.calleeId,
        callerName: user.displayName,
        contextType,
        contextId,
        expiresAt: created.session.expiresAt,
      });
    } catch {
      this.logger.error(`Invite failed for call ${created.session.callId}`);
      await this.store.failRinging(created.session.callId, 'invite_delivery_failed');
      throw ApiError.unavailable('INVITE_DELIVERY_FAILED', 'The call invite could not be delivered. Try again.');
    }

    if (!delivered) {
      await this.store.failRinging(created.session.callId, 'callee_unreachable');
      throw ApiError.gone('CALLEE_UNREACHABLE', 'The other person has no device that can receive this call.');
    }

    await this.store.setInviteCount(created.session.callId, delivered);
    return this.present(created.session, user.userId, parties.calleeName);
  }

  async active(user: AuthUser) {
    await this.store.expireUnanswered();
    const session = await this.store.findActiveForUser(user.userId);
    if (!session) return null;
    let parties;
    try {
      parties = await this.authorization.resolve(user.userId, session.contextType, session.contextId);
    } catch (error) {
      if (error instanceof ContextAccessError) {
        await this.store.transition(session.callId, ['ringing', 'answered', 'connecting', 'active'], 'ended', 'context_ended', null);
        await this.media.closeRoom(session.roomName);
        return null;
      }
      throw error;
    }
    const token = session.answeredAt
      ? await this.media.issueToken(session.roomName, user.userId, user.displayName)
      : undefined;
    return this.present(session, user.userId, parties.calleeName, token);
  }

  async accept(user: AuthUser, callId: string) {
    const session = await this.requireParticipant(callId, user.userId);
    if (session.calleeId !== user.userId) {
      throw ApiError.forbidden('CALLEE_ONLY', 'Only the invited person can answer this call.');
    }
    const parties = await this.authorization.resolve(user.userId, session.contextType, session.contextId);
    if (session.status === 'answered' || session.status === 'active' || (session.status === 'connecting' && session.answeredAt)) {
      const token = await this.media.issueToken(session.roomName, user.userId, user.displayName);
      return this.present(session, user.userId, parties.calleeName, token);
    }
    if (Date.parse(session.expiresAt) <= Date.now()) {
      await this.transition(callId, user.userId, ['ringing', 'connecting'], 'missed', 'ring_timeout');
      throw ApiError.gone('CALL_EXPIRED', 'This call invitation has expired.');
    }
    const updated = await this.transition(callId, user.userId, ['ringing', 'connecting'], 'answered', null);
    const token = await this.media.issueToken(updated.roomName, user.userId, user.displayName);
    return this.present(updated, user.userId, parties.calleeName, token);
  }

  async decline(userId: string, callId: string) {
    const session = await this.requireParticipant(callId, userId);
    if (session.calleeId !== userId) {
      throw ApiError.forbidden('CALLEE_ONLY', 'Only the invited person can decline this call.');
    }
    return this.finish(callId, userId, ['ringing'], 'declined', 'declined');
  }

  cancel(userId: string, callId: string) {
    return this.finish(callId, userId, ['ringing'], 'cancelled', 'caller_cancelled', true);
  }

  end(userId: string, callId: string, reason = 'participant_ended') {
    return this.finish(callId, userId, ['ringing', 'answered', 'connecting', 'active'], 'ended', reason);
  }

  async markParticipantJoined(callId: string, userId: string, participantCount?: number) {
    return this.store.markJoined(callId, userId, participantCount ?? 0);
  }

  async markParticipantLeft(callId: string, userId: string) {
    const updated = await this.store.markLeft(callId, userId);
    if (updated) await this.closeAndNotify(updated, updated.endReason || 'participant_disconnected', userId);
    return updated;
  }

  async reap(): Promise<void> {
    const expired = await this.store.expireUnanswered();
    await Promise.all(expired.map((session) => this.closeAndNotify(session, 'ring_timeout')));

    const live = await this.store.listLive();
    for (const session of live) {
      const allowed = await this.authorization.stillAllowed(session.contextType, session.contextId);
      if (allowed) continue;
      const ended = await this.store.transition(
        session.callId,
        ['ringing', 'answered', 'connecting', 'active'],
        'ended',
        'context_ended',
        null,
      );
      if (ended) await this.closeAndNotify(ended, 'context_ended');
    }

    await this.store.purgeTerminal(retentionDays());
  }

  private async finish(
    callId: string,
    userId: string,
    from: CallStatus[],
    status: CallStatus,
    reason: string,
    callerOnly = false,
  ) {
    const session = await this.requireParticipant(callId, userId);
    if (callerOnly && session.callerId !== userId) {
      throw ApiError.forbidden('CALLER_ONLY', 'Only the person who started this call can cancel it.');
    }
    if (isTerminal(session.status)) return this.present(session, userId);

    const updated = await this.store.transition(callId, from, status, reason, userId);
    if (!updated) {
      const current = await this.requireParticipant(callId, userId);
      if (current.status === status || isTerminal(current.status)) return this.present(current, userId);
      throw conflict(current.status);
    }
    await this.closeAndNotify(updated, reason, userId);
    return this.present(updated, userId);
  }

  private async transition(
    callId: string,
    actorId: string,
    from: CallStatus[],
    to: CallStatus,
    reason: string | null,
  ): Promise<CallSession> {
    const updated = await this.store.transition(callId, from, to, reason, actorId);
    if (updated) return updated;
    const current = await this.requireParticipant(callId, actorId);
    if (current.status === to) return current;
    throw conflict(current.status);
  }

  private async requireParticipant(callId: string, userId: string): Promise<CallSession> {
    const session = await this.store.findForParticipant(callId, userId);
    if (!session) throw ApiError.notFound('CALL_NOT_FOUND', 'This call is no longer available.');
    return session;
  }

  private async closeAndNotify(session: CallSession, reason: string, actorUserId?: string) {
    await this.media.closeRoom(session.roomName);
    const recipients = [session.callerId, session.calleeId].filter((userId) => userId !== actorUserId);
    await Promise.all(recipients.map((userId) => this.pushes.sendTerminal(userId, session.callId, reason)));
  }

  private present(session: CallSession, viewerUserId: string, peerName?: string, participantToken?: string) {
    return {
      callId: session.callId,
      contextType: session.contextType,
      contextId: session.contextId,
      status: session.status,
      direction: viewerUserId === session.callerId ? 'outgoing' : viewerUserId === session.calleeId ? 'incoming' : undefined,
      peerName,
      expiresAt: session.expiresAt,
      initiatedAt: session.initiatedAt,
      answeredAt: session.answeredAt,
      connectedAt: session.connectedAt,
      endedAt: session.endedAt,
      endReason: session.endReason,
      ...(participantToken ? { serverUrl: this.media.serverUrl(), participantToken } : {}),
    };
  }
}

function conflict(status: string): ApiError {
  return ApiError.conflict('CALL_CONFLICT', conflictMessage(status), { status });
}

function conflictMessage(status: string): string {
  switch (status) {
    case 'ringing':
      return 'This call is still ringing.';
    case 'answered':
    case 'connecting':
    case 'active':
      return 'This call is already in progress.';
    case 'declined':
      return 'This call was declined.';
    case 'missed':
      return 'This call was missed.';
    case 'cancelled':
      return 'This call was cancelled.';
    case 'ended':
      return 'This call has ended.';
    default:
      return 'This call could not be completed.';
  }
}
