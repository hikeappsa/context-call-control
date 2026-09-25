import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import type { CallStore } from './call-store';
import { isTerminal, type CallSession, type CallStatus, type NewRingingCall } from './call.types';

interface CallRow {
  call_id: string;
  context_type: string;
  context_id: string;
  caller_id: string;
  callee_id: string;
  room_name: string;
  status: CallStatus;
  invite_delivery_count: number;
  start_idempotency_key: string | null;
  initiated_at: Date;
  expires_at: Date;
  answered_at: Date | null;
  connected_at: Date | null;
  ended_at: Date | null;
  end_reason: string | null;
}

const SESSION_COLUMNS = `
  call_id, context_type, context_id, caller_id, callee_id, room_name, status,
  invite_delivery_count, start_idempotency_key, initiated_at, expires_at,
  answered_at, connected_at, ended_at, end_reason
`;

@Injectable()
export class SqlCallStore implements CallStore {
  constructor(private readonly database: DatabaseService) {}

  async createRinging(input: NewRingingCall): Promise<{ session: CallSession; created: boolean }> {
    const parties = [input.callerId, input.calleeId].sort();
    try {
      return await this.database.transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`call:${parties[0]}`]);
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`call:${parties[1]}`]);

        const existing = await client.query<CallRow>(
          `SELECT ${SESSION_COLUMNS} FROM call_sessions
            WHERE caller_id = $1 AND start_idempotency_key = $2
            LIMIT 1`,
          [input.callerId, input.idempotencyKey],
        );
        if (existing.rows[0]) return { session: mapSession(existing.rows[0]), created: false };

        const busy = await client.query(
          `SELECT 1 FROM call_sessions
            WHERE status IN ('ringing','answered','connecting','active')
              AND (caller_id = ANY($1::text[]) OR callee_id = ANY($1::text[]))
            LIMIT 1`,
          [parties],
        );
        if (busy.rowCount) {
          throw new ConflictException('You or the other participant is already in another call.');
        }

        const inserted = await client.query<CallRow>(
          `INSERT INTO call_sessions (
             call_id, context_type, context_id, caller_id, callee_id, room_name,
             status, expires_at, start_idempotency_key
           ) VALUES ($1,$2,$3,$4,$5,$6,'ringing',$7,$8)
           RETURNING ${SESSION_COLUMNS}`,
          [
            input.callId,
            input.contextType,
            input.contextId,
            input.callerId,
            input.calleeId,
            input.roomName,
            input.expiresAt,
            input.idempotencyKey,
          ],
        );
        await appendEvent(client, input.callId, 'initiated', input.callerId, {
          contextType: input.contextType,
          contextId: input.contextId,
        });
        return { session: mapSession(inserted.rows[0]), created: true };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        const existing = await this.database.query<CallRow>(
          `SELECT ${SESSION_COLUMNS} FROM call_sessions
            WHERE caller_id = $1 AND start_idempotency_key = $2
            LIMIT 1`,
          [input.callerId, input.idempotencyKey],
        );
        if (existing.rows[0]) return { session: mapSession(existing.rows[0]), created: false };
      }
      throw error;
    }
  }

  async findForParticipant(callId: string, userId: string): Promise<CallSession | null> {
    const result = await this.database.query<CallRow>(
      `SELECT ${SESSION_COLUMNS} FROM call_sessions
        WHERE call_id = $1 AND (caller_id = $2 OR callee_id = $2)`,
      [callId, userId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async findActiveForUser(userId: string): Promise<CallSession | null> {
    const result = await this.database.query<CallRow>(
      `SELECT ${SESSION_COLUMNS} FROM call_sessions
        WHERE status IN ('ringing','answered','connecting','active')
          AND (caller_id = $1 OR callee_id = $1)
        ORDER BY initiated_at DESC
        LIMIT 1`,
      [userId],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async listLive(): Promise<CallSession[]> {
    const result = await this.database.query<CallRow>(
      `SELECT ${SESSION_COLUMNS} FROM call_sessions
        WHERE status IN ('ringing','answered','connecting','active')`,
    );
    return result.rows.map(mapSession);
  }

  async transition(
    callId: string,
    from: CallStatus[],
    to: CallStatus,
    reason: string | null,
    actorId: string | null,
  ): Promise<CallSession | null> {
    const terminal = isTerminal(to);
    const result = await this.database.query<CallRow>(
      `UPDATE call_sessions
          SET status = $3::text,
              end_reason = COALESCE($4::text, end_reason),
              answered_at = CASE WHEN $3::text = 'answered' THEN COALESCE(answered_at, now()) ELSE answered_at END,
              ended_at = CASE WHEN $5::boolean THEN COALESCE(ended_at, now()) ELSE ended_at END,
              updated_at = now()
        WHERE call_id = $1 AND status = ANY($2::text[])
        RETURNING ${SESSION_COLUMNS}`,
      [callId, from, to, reason, terminal],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.database.query(
      `INSERT INTO call_events (call_id, event_type, actor_id, event_data)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [callId, to, actorId, JSON.stringify({ reason })],
    );
    return mapSession(row);
  }

  async markJoined(callId: string, userId: string, participantCount: number): Promise<CallSession | null> {
    const next: CallStatus = participantCount >= 2 ? 'active' : 'connecting';
    const result = await this.database.query<CallRow>(
      `UPDATE call_sessions
          SET status = $3::text,
              connected_at = CASE WHEN $3::text = 'active' THEN COALESCE(connected_at, now()) ELSE connected_at END,
              updated_at = now()
        WHERE call_id = $1
          AND status = ANY($4::text[])
          AND (caller_id = $2 OR callee_id = $2)
        RETURNING ${SESSION_COLUMNS}`,
      [callId, userId, next, ['answered', 'connecting', 'active']],
    );
    return result.rows[0] ? mapSession(result.rows[0]) : null;
  }

  async markLeft(callId: string, userId: string): Promise<CallSession | null> {
    const result = await this.database.query<CallRow>(
      `UPDATE call_sessions
          SET status = 'ended',
              end_reason = 'participant_disconnected',
              ended_at = now(),
              updated_at = now()
        WHERE call_id = $1
          AND status IN ('answered','connecting','active')
          AND (caller_id = $2 OR callee_id = $2)
        RETURNING ${SESSION_COLUMNS}`,
      [callId, userId],
    );
    const row = result.rows[0];
    if (!row) return null;
    await this.database.query(
      `INSERT INTO call_events (call_id, event_type, actor_id, event_data)
       VALUES ($1, 'ended', $2, $3::jsonb)`,
      [callId, userId, JSON.stringify({ reason: 'participant_disconnected' })],
    );
    return mapSession(row);
  }

  async failRinging(callId: string, reason: string): Promise<void> {
    await this.transition(callId, ['ringing'], 'failed', reason, null);
  }

  async setInviteCount(callId: string, count: number): Promise<void> {
    await this.database.query(
      `UPDATE call_sessions SET invite_delivery_count = $2, updated_at = now() WHERE call_id = $1`,
      [callId, count],
    );
  }

  async expireUnanswered(): Promise<CallSession[]> {
    const result = await this.database.query<CallRow>(
      `UPDATE call_sessions
          SET status = 'missed', end_reason = 'ring_timeout', ended_at = now(), updated_at = now()
        WHERE status IN ('ringing','connecting')
          AND answered_at IS NULL
          AND expires_at <= now()
        RETURNING ${SESSION_COLUMNS}`,
    );
    return result.rows.map(mapSession);
  }

  async purgeTerminal(retentionDays: number): Promise<void> {
    await this.database.query(
      `DELETE FROM call_sessions
        WHERE status IN ('declined','missed','cancelled','ended','failed')
          AND ended_at IS NOT NULL
          AND ended_at < now() - ($1::text || ' days')::interval`,
      [retentionDays],
    );
  }
}

function mapSession(row: CallRow): CallSession {
  return {
    callId: row.call_id,
    contextType: row.context_type,
    contextId: row.context_id,
    callerId: row.caller_id,
    calleeId: row.callee_id,
    roomName: row.room_name,
    status: row.status,
    inviteDeliveryCount: row.invite_delivery_count,
    startIdempotencyKey: row.start_idempotency_key,
    initiatedAt: toIso(row.initiated_at),
    expiresAt: toIso(row.expires_at),
    answeredAt: row.answered_at ? toIso(row.answered_at) : null,
    connectedAt: row.connected_at ? toIso(row.connected_at) : null,
    endedAt: row.ended_at ? toIso(row.ended_at) : null,
    endReason: row.end_reason,
  };
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

async function appendEvent(
  client: PoolClient,
  callId: string,
  eventType: string,
  actorId: string | null,
  data: Record<string, unknown>,
): Promise<void> {
  await client.query(
    `INSERT INTO call_events (call_id, event_type, actor_id, event_data) VALUES ($1, $2, $3, $4::jsonb)`,
    [callId, eventType, actorId, JSON.stringify(data)],
  );
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '23505';
}
