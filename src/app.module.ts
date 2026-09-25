import { Module } from '@nestjs/common';
import { DevJwtGuard } from './auth/dev-jwt.guard';
import { CallController } from './calls/call.controller';
import { CallReaperService } from './calls/call-reaper.service';
import { CallService } from './calls/call.service';
import { CALL_STORE } from './calls/call-store';
import { SqlCallStore } from './calls/sql-call.store';
import { DevContextController } from './contexts/dev-context.controller';
import { SqlContextAuthorizer } from './contexts/sql-context-authorizer';
import { DatabaseService } from './database/database.service';
import { DeviceEndpointController } from './devices/device-endpoint.controller';
import { DeviceEndpointService } from './devices/device-endpoint.service';
import { HealthController } from './health.controller';
import { LiveKitMediaSession } from './media/livekit-media.session';
import { LiveKitWebhookVerifier } from './media/livekit-webhook.verifier';
import { MediaWebhookController } from './media/media-webhook.controller';
import { CONTEXT_AUTHORIZER } from './ports/context-authorizer';
import { MEDIA_SESSION } from './ports/media-session';
import { MEDIA_WEBHOOK_VERIFIER } from './ports/media-webhook';
import { PUSH_NOTIFIER } from './ports/push-notifier';
import { LogPushNotifier } from './push/log-push.notifier';

@Module({
  controllers: [
    HealthController,
    CallController,
    DeviceEndpointController,
    MediaWebhookController,
    DevContextController,
  ],
  providers: [
    DatabaseService,
    DevJwtGuard,
    CallService,
    CallReaperService,
    SqlContextAuthorizer,
    DeviceEndpointService,
    { provide: CALL_STORE, useClass: SqlCallStore },
    { provide: CONTEXT_AUTHORIZER, useExisting: SqlContextAuthorizer },
    { provide: PUSH_NOTIFIER, useClass: LogPushNotifier },
    { provide: MEDIA_SESSION, useClass: LiveKitMediaSession },
    { provide: MEDIA_WEBHOOK_VERIFIER, useClass: LiveKitWebhookVerifier },
  ],
})
export class AppModule {}
