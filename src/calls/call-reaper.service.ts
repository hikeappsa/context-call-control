import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CallService } from './call.service';

@Injectable()
export class CallReaperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CallReaperService.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly calls: CallService) {}

  onModuleInit(): void {
    this.timer = setInterval(() => {
      void this.calls.reap().catch((error: unknown) => {
        this.logger.error(`Call reaper failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
