import { SignJWT } from 'jose';

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index === -1) return undefined;
  return process.argv[index + 1];
}

async function main(): Promise<void> {
  const sub = argument('--sub');
  const name = argument('--name') || sub;
  const secret = process.env.DEV_JWT_SECRET;
  if (!sub || !secret) {
    throw new Error('Usage: DEV_JWT_SECRET=... npm run dev-token -- --sub alice --name Alice');
  }
  const token = await new SignJWT({ name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(sub)
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(new TextEncoder().encode(secret));
  process.stdout.write(`${token}\n`);
}

void main();
