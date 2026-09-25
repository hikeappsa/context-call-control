export function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function callsEnabled(): boolean {
  return process.env.CALLS_ENABLED === 'true';
}

export function devContextsEnabled(): boolean {
  return process.env.DEV_CONTEXTS_ENABLED === 'true';
}

export function ringSeconds(): number {
  const value = Number(process.env.CALL_RING_SECONDS || 30);
  if (!Number.isFinite(value) || value < 5 || value > 180) {
    throw new Error('CALL_RING_SECONDS must be a number between 5 and 180');
  }
  return value;
}

export function tokenTtlSeconds(): number {
  const value = Number(process.env.CALL_TOKEN_TTL_SECONDS || 30);
  if (!Number.isInteger(value) || value < 10 || value > 120) {
    throw new Error('CALL_TOKEN_TTL_SECONDS must be an integer between 10 and 120');
  }
  return value;
}

export function retentionDays(): number {
  const value = Number(process.env.CALL_RETENTION_DAYS || 90);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error('CALL_RETENTION_DAYS must be a positive integer');
  }
  return value;
}

const OPAQUE_ID = /^[A-Za-z0-9_.:-]{1,128}$/;

export function opaqueId(value: unknown, label: string, max = 128): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!OPAQUE_ID.test(text) || text.length > max) {
    throw new Error(`${label} must be 1-${max} characters and use only letters, numbers, and _ . : -`);
  }
  return text;
}
