import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { ApiError } from '../common/api-error';
import { jwtVerify } from 'jose';
import { requiredEnv } from '../config/env';
import type { AuthUser } from '../ports/identity';

@Injectable()
export class DevJwtGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ headers: { authorization?: string }; user?: AuthUser }>();
    const header = request.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) throw ApiError.unauthorized('MISSING_TOKEN', 'Sign in to continue.');
    try {
      const { payload } = await jwtVerify(header.slice(7), secret(), { algorithms: ['HS256'] });
      const userId = typeof payload.sub === 'string' ? payload.sub.trim() : '';
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(userId)) {
        throw ApiError.unauthorized('INVALID_TOKEN', 'Your session is not valid. Sign in again.');
      }
      const name = typeof payload.name === 'string' ? payload.name.trim().slice(0, 80) : '';
      request.user = { userId, displayName: name || userId };
      return true;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw ApiError.unauthorized('INVALID_TOKEN', 'Your session is not valid. Sign in again.');
    }
  }
}

function secret(): Uint8Array {
  return new TextEncoder().encode(requiredEnv('DEV_JWT_SECRET'));
}
