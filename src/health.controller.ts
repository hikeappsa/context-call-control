import { Controller, Get } from '@nestjs/common';
import { ApiError } from './common/api-error';
import { DatabaseService } from './database/database.service';

@Controller('health')
export class HealthController {
  constructor(private readonly database: DatabaseService) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.database.ping();
      return { status: 'ok' };
    } catch {
      throw ApiError.unavailable('DATABASE_UNAVAILABLE', 'The service cannot reach its database.');
    }
  }
}
