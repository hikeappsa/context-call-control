export interface CallParties {
  contextType: string;
  contextId: string;
  callerId: string;
  calleeId: string;
  callerName: string;
  calleeName: string;
}

export interface ContextAuthorizer {
  resolve(userId: string, contextType: string, contextId: string): Promise<CallParties>;
  stillAllowed(contextType: string, contextId: string): Promise<boolean>;
}

export const CONTEXT_AUTHORIZER = Symbol('CONTEXT_AUTHORIZER');
