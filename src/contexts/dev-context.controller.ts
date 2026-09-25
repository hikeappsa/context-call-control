import { Body, Controller, Post } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { devContextsEnabled, opaqueId } from '../config/env';
import { SqlContextAuthorizer } from './sql-context-authorizer';

interface SeedBody {
  contextType?: unknown;
  contextId?: unknown;
  participantA?: unknown;
  participantB?: unknown;
  nameA?: unknown;
  nameB?: unknown;
  active?: unknown;
}

@Controller('dev/contexts')
export class DevContextController {
  constructor(private readonly contexts: SqlContextAuthorizer) {}

  @Post()
  async seed(@Body() body: SeedBody) {
    if (!devContextsEnabled()) throw ApiError.notFound('NOT_FOUND', 'Not found.');
    const contextType = readId(body.contextType, 'contextType', 64);
    const contextId = readId(body.contextId, 'contextId', 128);
    const participantA = readId(body.participantA, 'participantA', 128);
    const participantB = readId(body.participantB, 'participantB', 128);
    if (participantA === participantB) {
      throw ApiError.badRequest('INVALID_CONTEXT', 'The two participants must be different people.');
    }
    const nameA = readName(body.nameA, 'nameA');
    const nameB = readName(body.nameB, 'nameB');
    const active = body.active === undefined ? true : body.active === true;
    await this.contexts.upsert({ contextType, contextId, participantA, participantB, nameA, nameB, active });
    return { contextType, contextId, active };
  }
}

function readId(value: unknown, label: string, max: number): string {
  try {
    return opaqueId(value, label, max);
  } catch (error) {
    throw ApiError.badRequest('INVALID_CONTEXT', error instanceof Error ? error.message : `${label} is not valid.`, {
      field: label,
    });
  }
}

function readName(value: unknown, label: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 80) {
    throw ApiError.badRequest('INVALID_CONTEXT', `${label} must be 1-80 characters.`, { field: label });
  }
  return text;
}
