import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { jwtVerify } from 'jose';
import { requiredEnv } from '../config/env';
import type { AuthUser } from '../ports/identity';

@Injectable()
export class DevJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: AuthUser }>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw new UnauthorizedException('Missing bearer token');
    try {
      const { payload } = await jwtVerify(header.slice(7), secret(), { algorithms: ['HS256'] });
      const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(userId)) throw new UnauthorizedException('Invalid token subject');
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
      request.user = { userId, displayName: name || userId };
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Invalid bearer token');
    }
  }
}

function secret(): Uint8Array {
  return new TextEncoder().encode(requiredEnv('DEV_JWT_SECRET'));
}
