import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';
import { ApiError } from '../common/api-error';
import { ContextAccessError, ParticipantBusyError } from '../common/domain-error';
import type { CallParties, ContextAuthorizer } from '../ports/context-authorizer';
import type { AuthUser } from '../ports/identity';
import type { MediaSession } from '../ports/media-session';
import type { PushNotifier } from '../ports/push-notifier';
import { CallService } from './call.service';
import { MemoryCallStore } from './memory-call.store';

const alice: AuthUser = { userId: 'alice', displayName: 'Alice' };
const bob: AuthUser = { userId: 'bob', displayName: 'Bob' };
const carol: AuthUser = { userId: 'carol', displayName: 'Carol' };

class FakeAuthorizer implements ContextAuthorizer {
  allowed = true;
  readonly pairs = new Map<string, [string, string]>();

  async resolve(userId: string, contextType: string, contextId: string): Promise<CallParties> {
    const pair = this.pairs.get(`${contextType}:${contextId}`);
    if (!pair || !this.allowed) {
      throw new ContextAccessError('CONTEXT_NOT_ACTIVE', 'Calling is not available for this context.');
    }
    if (userId !== pair[0] && userId !== pair[1]) {
      throw new ContextAccessError('NOT_A_PARTICIPANT', 'You are not a participant in this context.');
    }
    const calleeId = userId === pair[0] ? pair[1] : pair[0];
    return {
      contextType,
      contextId,
      callerId: userId,
      calleeId,
      callerName: userId,
      calleeName: calleeId,
    };
  }

  async stillAllowed(): Promise<boolean> {
    return this.allowed;
  }
}

class FakeMedia implements MediaSession {
  readonly closed: string[] = [];

  serverUrl(): string {
    return 'ws://media.local';
  }

  async issueToken(roomName: string, userId: string): Promise<string> {
    return `${userId}@${roomName}`;
  }

  async closeRoom(roomName: string): Promise<void> {
    this.closed.push(roomName);
  }
}

class FakePush implements PushNotifier {
  delivered = 1;
  fail = false;
  invites = 0;
  readonly terminals: string[] = [];

  async sendInvite(): Promise<number> {
    this.invites += 1;
    if (this.fail) throw new Error('push down');
    return this.delivered;
  }

  async sendTerminal(userId: string, callId: string, reason: string): Promise<void> {
    this.terminals.push(`${userId}:${callId}:${reason}`);
  }
}

describe('call control', () => {
  let store: MemoryCallStore;
  let authorizer: FakeAuthorizer;
  let media: FakeMedia;
  let push: FakePush;
  let service: CallService;

  beforeEach(() => {
    process.env.CALLS_ENABLED = 'true';
    process.env.CALL_RING_SECONDS = '30';
    process.env.CALL_RETENTION_DAYS = '90';
    store = new MemoryCallStore();
    authorizer = new FakeAuthorizer();
    authorizer.pairs.set('session:demo', ['alice', 'bob']);
    media = new FakeMedia();
    push = new FakePush();
    service = new CallService(store, authorizer, media, push);
  });

  it('does not issue a media token when a call starts', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    assert.equal(started.status, 'ringing');
    assert.equal('participantToken' in started, false);
    assert.equal(started.peerName, 'bob');

    const active = await service.active(alice);
    assert.equal(active?.status, 'ringing');
    assert.equal(active && 'participantToken' in active, false);
  });

  it('issues tokens only after the callee accepts', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    const accepted = await service.accept(bob, started.callId);
    assert.equal(accepted.status, 'answered');
    assert.equal(accepted.participantToken, `bob@call-${started.callId}`);
    assert.equal(accepted.serverUrl, 'ws://media.local');

    const caller = await service.active(alice);
    assert.equal(caller?.participantToken, `alice@call-${started.callId}`);
  });

  it('replays an idempotent start without a second invite', async () => {
    const first = await service.start(alice, 'session', 'demo', 'key-1');
    const second = await service.start(alice, 'session', 'demo', 'key-1');
    assert.equal(first.callId, second.callId);
    assert.equal(push.invites, 1);
  });

  it('blocks a second live call for either participant', async () => {
    await service.start(alice, 'session', 'demo', 'key-1');
    authorizer.pairs.set('session:other', ['bob', 'carol']);
    await assert.rejects(() => service.start(bob, 'session', 'other', 'key-2'), ParticipantBusyError);
  });

  it('lets only the callee decline and only the caller cancel', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    await expectCode(service.decline(alice.userId, started.callId), 'CALLEE_ONLY');
    await expectCode(service.cancel(bob.userId, started.callId), 'CALLER_ONLY');
    const declined = await service.decline(bob.userId, started.callId);
    assert.equal(declined.status, 'declined');
    assert.equal(media.closed[0], `call-${started.callId}`);
  });

  it('marks an expired invite as missed', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    store.expireForTest(started.callId);
    await expectCode(service.accept(bob, started.callId), 'CALL_EXPIRED');
    const stored = await store.findForParticipant(started.callId, bob.userId);
    assert.equal(stored?.status, 'missed');
    assert.equal(stored?.endReason, 'ring_timeout');
  });

  it('fails the call when the invite reaches nobody', async () => {
    push.delivered = 0;
    await expectCode(service.start(alice, 'session', 'demo', 'key-1'), 'CALLEE_UNREACHABLE');
    const stored = await store.findActiveForUser(alice.userId);
    assert.equal(stored, null);
    const missed = await service.start(alice, 'session', 'demo', 'key-1');
    assert.equal(missed.status, 'failed');
  });

  it('fails the call when invite delivery throws', async () => {
    push.fail = true;
    await expectCode(service.start(alice, 'session', 'demo', 'key-1'), 'INVITE_DELIVERY_FAILED');
    push.fail = false;
    const replay = await service.start(alice, 'session', 'demo', 'key-1');
    assert.equal(replay.status, 'failed');
  });

  it('refuses a caller who is not in the context', async () => {
    await assert.rejects(() => service.start(carol, 'session', 'demo', 'key-1'), ContextAccessError);
  });

  it('does not treat a media join as an answer while ringing', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    const joined = await service.markParticipantJoined(started.callId, alice.userId, 2);
    assert.equal(joined, null);
    const stored = await store.findForParticipant(started.callId, alice.userId);
    assert.equal(stored?.status, 'ringing');
  });

  it('moves an answered call to active when both participants have joined', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    await service.accept(bob, started.callId);
    const connecting = await service.markParticipantJoined(started.callId, bob.userId, 1);
    assert.equal(connecting?.status, 'connecting');
    const active = await service.markParticipantJoined(started.callId, alice.userId, 2);
    assert.equal(active?.status, 'active');
    assert.ok(active?.connectedAt);
  });

  it('ends a live call when the context is no longer allowed', async () => {
    const started = await service.start(alice, 'session', 'demo', 'key-1');
    authorizer.allowed = false;
    await service.reap();
    const stored = await store.findForParticipant(started.callId, alice.userId);
    assert.equal(stored?.status, 'ended');
    assert.equal(stored?.endReason, 'context_ended');
    assert.deepEqual(media.closed, [`call-${started.callId}`]);
    assert.equal(push.terminals.length, 2);
  });
});

async function expectCode(work: Promise<unknown>, code: string): Promise<void> {
  await assert.rejects(work, (error: unknown) => {
    assert.ok(error instanceof ApiError);
    const body = error.getResponse() as { code?: string; message?: string };
    assert.equal(body.code, code);
    assert.equal(typeof body.message, 'string');
    assert.ok(body.message && body.message.length > 0);
    return true;
  });
}
