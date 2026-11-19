// Real Web Crypto API AES-256-GCM encryption for sensitive dialect archives & field PII

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function hashPassphraseFingerprint(passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(passphrase));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export async function encryptPayload(plaintextObject: unknown, passphrase: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(passphrase, salt);
  const data = enc.encode(JSON.stringify(plaintextObject));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    data
  );

  return JSON.stringify({
    v: 1,
    alg: 'AES-256-GCM',
    salt: toBase64(salt),
    iv: toBase64(iv),
    ct: toBase64(new Uint8Array(ciphertext)),
  });
}

export async function decryptPayload<T = Record<string, string>>(
  encryptedJson: string,
  passphrase: string
): Promise<T> {
  const parsed = JSON.parse(encryptedJson);
  if (!parsed || !parsed.salt || !parsed.iv || !parsed.ct) {
    throw new Error('Invalid encrypted payload format.');
  }
  const salt = fromBase64(parsed.salt);
  const iv = fromBase64(parsed.iv);
  const ct = fromBase64(parsed.ct);
  const key = await deriveAesKey(passphrase, salt);

  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    ct as BufferSource
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted)) as T;
}
