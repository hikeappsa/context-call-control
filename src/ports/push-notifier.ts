export interface CallInvite {
  callId: string;
  calleeId: string;
  callerName: string;
  contextType: string;
  contextId: string;
  expiresAt: string;
}

export interface PushNotifier {
  sendInvite(invite: CallInvite): Promise<number>;
  sendTerminal(userId: string, callId: string, reason: string): Promise<void>;
}

export const PUSH_NOTIFIER = Symbol('PUSH_NOTIFIER');
