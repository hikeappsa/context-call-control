export const LIVE_CALL_STATUSES = ['ringing', 'answered', 'connecting', 'active'] as const;
export const TERMINAL_CALL_STATUSES = ['declined', 'missed', 'cancelled', 'ended', 'failed'] as const;

export type LiveCallStatus = (typeof LIVE_CALL_STATUSES)[number];
export type TerminalCallStatus = (typeof TERMINAL_CALL_STATUSES)[number];
export type CallStatus = LiveCallStatus | TerminalCallStatus;

export interface CallSession {
  callId: string;
  contextType: string;
  contextId: string;
  callerId: string;
  calleeId: string;
  roomName: string;
  status: CallStatus;
  inviteDeliveryCount: number;
  startIdempotencyKey: string | null;
  initiatedAt: string;
  expiresAt: string;
  answeredAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
}

export interface NewRingingCall {
  callId: string;
  contextType: string;
  contextId: string;
  callerId: string;
  calleeId: string;
  roomName: string;
  expiresAt: string;
  idempotencyKey: string;
}

export function isTerminal(status: string): boolean {
  return (TERMINAL_CALL_STATUSES as readonly string[]).includes(status);
}

export function isLive(status: string): boolean {
  return (LIVE_CALL_STATUSES as readonly string[]).includes(status);
}
