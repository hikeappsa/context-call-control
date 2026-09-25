import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthUser } from '../ports/identity';

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<{ user: AuthUser }>().user;
});
