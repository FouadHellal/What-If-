import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

function scryptAsync(password: string, salt: Buffer, N: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFKC'), salt, KEYLEN, { N, r: SCRYPT_R, p: SCRYPT_P, maxmem: 256 * N * SCRYPT_R + 1024 * 1024 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** Hashes a password with scrypt. Format: `scrypt$N$r$p$salt$hash` (base64url). */
export async function hashPassword(password: string, cost: number): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, cost);
  return ['scrypt', cost, SCRYPT_R, SCRYPT_P, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  if (!Number.isInteger(N) || N < 1024) return false;
  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const key = await scryptAsync(password, salt, N);
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** Whether a stored hash uses a lower cost than currently configured (rehash on login). */
export function needsRehash(stored: string, cost: number): boolean {
  const N = Number(stored.split('$')[1]);
  return !Number.isFinite(N) || N < cost;
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Symmetric encryption for secrets at rest (AI provider keys). AES-256-GCM with an HKDF-derived key. */
export class SecretBox {
  private readonly key: Buffer;

  constructor(appSecret: string) {
    this.key = Buffer.from(hkdfSync('sha256', appSecret, 'what-if/secret-box', 'v1', 32));
  }

  encrypt(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return ['v1', iv.toString('base64url'), tag.toString('base64url'), enc.toString('base64url')].join('.');
  }

  decrypt(payload: string): string | null {
    try {
      const [v, iv, tag, enc] = payload.split('.');
      if (v !== 'v1' || !iv || !tag || !enc) return null;
      const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
      decipher.setAuthTag(Buffer.from(tag, 'base64url'));
      return Buffer.concat([decipher.update(Buffer.from(enc, 'base64url')), decipher.final()]).toString('utf8');
    } catch {
      return null;
    }
  }
}

/** Shows only the last four characters of a secret. */
export function keyHint(secret: string | null): string | null {
  if (!secret) return null;
  return secret.length <= 8 ? '••••' : `••••${secret.slice(-4)}`;
}
