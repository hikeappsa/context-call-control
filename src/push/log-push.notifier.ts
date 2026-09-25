import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import type { CallInvite, PushNotifier } from '../ports/push-notifier';

@Injectable()
export class LogPushNotifier implements PushNotifier {
  private readonly logger = new Logger(LogPushNotifier.name);

  constructor(private readonly database: DatabaseService) {}

  async sendInvite(invite: CallInvite): Promise<number> {
    const result = await this.database.query(
      `SELECT endpoint_id FROM device_endpoints WHERE user_id = $1 AND is_active = true`,
      [invite.calleeId],
    );
    const count = result.rowCount ?? 0;
    this.logger.log(
      `Invite call=${invite.callId} callee=${invite.calleeId} context=${invite.contextType}:${invite.contextId} endpoints=${count}`,
    );
    return count;
  }

  async sendTerminal(userId: string, callId: string, reason: string): Promise<void> {
    const result = await this.database.query(
      `SELECT endpoint_id FROM device_endpoints WHERE user_id = $1 AND is_active = true`,
      [userId],
    );
    this.logger.log(
      `Terminal call=${callId} user=${userId} reason=${reason} endpoints=${result.rowCount ?? 0}`,
    );
  }
}
