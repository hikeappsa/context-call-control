import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import { DevJwtGuard } from '../auth/dev-jwt.guard';
import type { AuthUser } from '../ports/identity';
import { DeviceEndpointService, type RegisterEndpointInput } from './device-endpoint.service';

@Controller('devices')
@UseGuards(DevJwtGuard)
export class DeviceEndpointController {
  constructor(private readonly endpoints: DeviceEndpointService) {}

  @Post('call-endpoint')
  register(@CurrentUser() user: AuthUser, @Body() input: RegisterEndpointInput) {
    return this.endpoints.register(user.userId, input);
  }

  @Post('call-endpoint/deactivate')
  deactivate(@CurrentUser() user: AuthUser, @Body() input: Pick<RegisterEndpointInput, 'clientKind' | 'deviceId'>) {
    return this.endpoints.deactivate(user.userId, input?.clientKind, input?.deviceId);
  }
}
