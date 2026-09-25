import { Injectable } from '@nestjs/common';
import { ContextAccessError } from '../common/domain-error';
import { DatabaseService } from '../database/database.service';
import type { CallParties, ContextAuthorizer } from '../ports/context-authorizer';

interface ContextRow {
  context_type: string;
  context_id: string;
  participant_a: string;
  participant_b: string;
  name_a: string;
  name_b: string;
  active: boolean;
}

@Injectable()
export class SqlContextAuthorizer implements ContextAuthorizer {
  constructor(private readonly database: DatabaseService) {}

  async resolve(userId: string, contextType: string, contextId: string): Promise<CallParties> {
    const row = await this.load(contextType, contextId);
    if (!row) throw new ContextAccessError('CONTEXT_NOT_FOUND', 'This context could not be found.');
    if (!row.active) throw new ContextAccessError('CONTEXT_NOT_ACTIVE', 'Calling is not available for this context.');
    if (userId === row.participant_a) {
      return this.parties(row, row.participant_a, row.participant_b, row.name_a, row.name_b);
    }
    if (userId === row.participant_b) {
      return this.parties(row, row.participant_b, row.participant_a, row.name_b, row.name_a);
    }
    throw new ContextAccessError('NOT_A_PARTICIPANT', 'You are not a participant in this context.');
  }

  async stillAllowed(contextType: string, contextId: string): Promise<boolean> {
    const row = await this.load(contextType, contextId);
    return Boolean(row?.active);
  }

  async upsert(input: {
    contextType: string;
    contextId: string;
    participantA: string;
    participantB: string;
    nameA: string;
    nameB: string;
    active?: boolean;
  }): Promise<void> {
    await this.database.query(
      `INSERT INTO call_contexts (
         context_type, context_id, participant_a, participant_b, name_a, name_b, active
       ) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (context_type, context_id) DO UPDATE
         SET participant_a = EXCLUDED.participant_a,
             participant_b = EXCLUDED.participant_b,
             name_a = EXCLUDED.name_a,
             name_b = EXCLUDED.name_b,
             active = EXCLUDED.active,
             updated_at = now()`,
      [
        input.contextType,
        input.contextId,
        input.participantA,
        input.participantB,
        input.nameA,
        input.nameB,
        input.active ?? true,
      ],
    );
  }

  private async load(contextType: string, contextId: string): Promise<ContextRow | null> {
    const result = await this.database.query<ContextRow>(
      `SELECT context_type, context_id, participant_a, participant_b, name_a, name_b, active
         FROM call_contexts
        WHERE context_type = $1 AND context_id = $2`,
      [contextType, contextId],
    );
    return result.rows[0] ?? null;
  }

  private parties(row: ContextRow, callerId: string, calleeId: string, callerName: string, calleeName: string): CallParties {
    return {
      contextType: row.context_type,
      contextId: row.context_id,
      callerId,
      calleeId,
      callerName,
      calleeName,
    };
  }
}
