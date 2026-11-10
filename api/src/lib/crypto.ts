import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

// AES-256-GCM for data at rest (PDF passwords, raw documents).
// Layout: [12-byte IV][16-byte auth tag][ciphertext]. The key is passed in
// (callers use env.DATA_KEY) so this module stays pure and unit-testable.

function keyBuf(hexKey: string): Buffer {
  const k = Buffer.from(hexKey, "hex");
  if (k.length !== 32) throw new Error("data key must be 32 bytes (64 hex chars)");
  return k;
}

export function encrypt(plain: Buffer | string, hexKey: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBuf(hexKey), iv);
  const body = Buffer.concat([cipher.update(typeof plain === "string" ? Buffer.from(plain, "utf8") : plain), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decrypt(blob: Buffer, hexKey: string): Buffer {
  const iv = blob.subarray(0, 12);
  const tag = blob.subarray(12, 28);
  const decipher = createDecipheriv("aes-256-gcm", keyBuf(hexKey), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
}

export const decryptString = (blob: Buffer, hexKey: string) => decrypt(blob, hexKey).toString("utf8");

export const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");

/** Lowercase, unambiguous, URL/email-safe random token (no 0/o/1/l). */
export function randomToken(length: number): string {
  const alphabet = "abcdefghijkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
