import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpStatus } from '@nestjs/common';
import { ApiError } from './api-error';
import { ContextAccessError, ParticipantBusyError } from './domain-error';
import { toErrorBody } from './http-error.filter';

describe('error responses', () => {
  it('gives context failures a code and a message', () => {
    const body = toErrorBody(new ContextAccessError('NOT_A_PARTICIPANT', 'You are not a participant in this context.'));
    assert.equal(body.statusCode, HttpStatus.FORBIDDEN);
    assert.equal(body.payload.code, 'NOT_A_PARTICIPANT');
    assert.match(body.payload.message, /participant/);
  });

  it('tells the client when someone is already on a call', () => {
    const body = toErrorBody(new ParticipantBusyError());
    assert.equal(body.statusCode, HttpStatus.CONFLICT);
    assert.equal(body.payload.code, 'PARTICIPANT_BUSY');
    assert.match(body.payload.message, /already on a call/);
  });

  it('keeps the code and details from an API error', () => {
    const body = toErrorBody(ApiError.conflict('CALL_CONFLICT', 'This call is already in progress.', { status: 'active' }));
    assert.equal(body.payload.code, 'CALL_CONFLICT');
    assert.equal(body.payload.message, 'This call is already in progress.');
    assert.deepEqual(body.payload.details, { status: 'active' });
  });

  it('hides unexpected failures behind a generic message', () => {
    const body = toErrorBody(new Error('password=secret'));
    assert.equal(body.payload.code, 'INTERNAL');
    assert.equal(body.payload.message, 'Something went wrong. Try again.');
    assert.equal(JSON.stringify(body.payload).includes('secret'), false);
  });
});
