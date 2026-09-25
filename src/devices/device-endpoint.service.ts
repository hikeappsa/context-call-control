import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { DatabaseService } from '../database/database.service';

export interface RegisterEndpointInput {
  deviceId?: unknown;
  clientKind?: unknown;
  platform?: unknown;
  pushProvider?: unknown;
  pushToken?: unknown;
  voipToken?: unknown;
  apnsEnvironment?: unknown;
}

interface NormalizedEndpoint {
  deviceId: string;
  clientKind: string;
  platform: string;
  pushProvider: string;
  pushToken: string | null;
  voipToken: string | null;
  apnsEnvironment: string | null;
}

@Injectable()
export class DeviceEndpointService {
  constructor(private readonly database: DatabaseService) {}

  async register(userId: string, input: RegisterEndpointInput) {
    const endpoint = normalize(input);
    const endpointId = randomUUID();
    await this.database.transaction(async (client) => {
      await client.query(
        `UPDATE device_endpoints
            SET is_active = false, updated_at = now()
          WHERE user_id = $1 AND platform = $2 AND device_id = $3 AND client_kind <> $4 AND is_active = true`,
        [userId, endpoint.platform, endpoint.deviceId, endpoint.clientKind],
      );
      if (endpoint.pushToken) {
        await client.query(
          `UPDATE device_endpoints
              SET is_active = false, updated_at = now()
            WHERE user_id = $1 AND platform = $2 AND push_provider = $3 AND push_token = $4
              AND (device_id <> $5 OR client_kind <> $6) AND is_active = true`,
          [userId, endpoint.platform, endpoint.pushProvider, endpoint.pushToken, endpoint.deviceId, endpoint.clientKind],
        );
      }
      if (endpoint.voipToken) {
        await client.query(
          `UPDATE device_endpoints
              SET is_active = false, updated_at = now()
            WHERE user_id = $1 AND platform = $2 AND voip_token = $3
              AND (device_id <> $4 OR client_kind <> $5) AND is_active = true`,
          [userId, endpoint.platform, endpoint.voipToken, endpoint.deviceId, endpoint.clientKind],
        );
      }
      await client.query(
        `INSERT INTO device_endpoints (
           endpoint_id, device_id, user_id, client_kind, platform, push_provider,
           push_token, voip_token, apns_environment, is_active, last_seen_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,now())
         ON CONFLICT (device_id, client_kind) DO UPDATE
           SET user_id = EXCLUDED.user_id,
               platform = EXCLUDED.platform,
               push_provider = EXCLUDED.push_provider,
               push_token = EXCLUDED.push_token,
               voip_token = EXCLUDED.voip_token,
               apns_environment = EXCLUDED.apns_environment,
               is_active = true,
               last_seen_at = now(),
               updated_at = now()`,
        [
          endpointId,
          endpoint.deviceId,
          userId,
          endpoint.clientKind,
          endpoint.platform,
          endpoint.pushProvider,
          endpoint.pushToken,
          endpoint.voipToken,
          endpoint.apnsEnvironment,
        ],
      );
    });
    return { deviceId: endpoint.deviceId, clientKind: endpoint.clientKind, active: true };
  }

  async deactivate(userId: string, clientKind: unknown, deviceId: unknown) {
    const kind = token(clientKind, 'clientKind', 32);
    const device = token(deviceId, 'deviceId', 128);
    await this.database.query(
      `UPDATE device_endpoints
          SET is_active = false, updated_at = now()
        WHERE user_id = $1 AND client_kind = $2 AND device_id = $3`,
      [userId, kind, device],
    );
    return { deviceId: device, clientKind: kind, active: false };
  }
}

function normalize(input: RegisterEndpointInput): NormalizedEndpoint {
  const pushToken = optionalSecret(input.pushToken, 'pushToken');
  const voipToken = optionalSecret(input.voipToken, 'voipToken');
  if (!pushToken && !voipToken) throw new BadRequestException('A push token or VoIP token is required');
  return {
    deviceId: token(input.deviceId, 'deviceId', 128),
    clientKind: token(input.clientKind, 'clientKind', 32),
    platform: token(input.platform, 'platform', 32),
    pushProvider: token(input.pushProvider, 'pushProvider', 32),
    pushToken,
    voipToken,
    apnsEnvironment: optionalToken(input.apnsEnvironment, 'apnsEnvironment', 32),
  };
}

function token(value: unknown, label: string, max: number): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(text) || text.length > max) {
    throw new BadRequestException(`${label} must be 1-${max} characters from [A-Za-z0-9_.:-]`);
  }
  return text;
}

function optionalToken(value: unknown, label: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return token(value, label, max);
}

function optionalSecret(value: unknown, label: string): string | null {
  if (value === undefined || value === null || value === '') return null;
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text || text.length > 2048) throw new BadRequestException(`${label} must be 1-2048 characters`);
  return text;
}
