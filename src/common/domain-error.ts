export type ContextAccessCode = 'CONTEXT_NOT_FOUND' | 'CONTEXT_NOT_ACTIVE' | 'NOT_A_PARTICIPANT';

export class ContextAccessError extends Error {
  readonly name = 'ContextAccessError';

  constructor(
    readonly code: ContextAccessCode,
    message: string,
  ) {
    super(message);
  }
}

export class ParticipantBusyError extends Error {
  readonly name = 'ParticipantBusyError';
  readonly code = 'PARTICIPANT_BUSY';

  constructor() {
    super('You or the other person is already on a call.');
  }
}
