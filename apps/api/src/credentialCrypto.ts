import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const algorithm = "aes-256-gcm";

function keyFromSecret(secret: string) {
  return createHash("sha256").update(secret).digest();
}

export function encryptPayload(payload: unknown, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv(algorithm, keyFromSecret(secret), iv);
  const plaintext = JSON.stringify(payload);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [iv, authTag, encrypted].map((part) => part.toString("base64url")).join(".");
}

export function decryptPayload<T>(encryptedPayload: string, secret: string): T {
  const [ivBase64, authTagBase64, encryptedBase64] = encryptedPayload.split(".");

  if (!ivBase64 || !authTagBase64 || !encryptedBase64) {
    throw new Error("Invalid encrypted payload");
  }

  const decipher = createDecipheriv(algorithm, keyFromSecret(secret), Buffer.from(ivBase64, "base64url"));
  decipher.setAuthTag(Buffer.from(authTagBase64, "base64url"));

  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedBase64, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(decrypted.toString("utf8")) as T;
}
