// Encrypted Delta API credentials (design Amendment B.3). AES-256-GCM with SECRETS_KEY (32 bytes, hex),
// a random 12-byte IV per save, and AAD binding the visible metadata (keyLast4, savedAt) to the ciphertext.
// The secret is never logged, never returned by an endpoint, and backups only ever contain this encrypted row.

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Repo } from './repo.js';

export interface Creds {
  apiKey: string;
  apiSecret: string;
}

export interface CredMeta {
  keyLast4: string;
  savedAt: number;
}

interface Blob extends CredMeta {
  v: 1;
  iv: string;
  tag: string;
  ct: string;
}

export type StoredCreds = { status: 'none' } | { status: 'ok'; creds: Creds; meta: CredMeta } | { status: 'unreadable'; meta: CredMeta | null; reason: string };

const KV = 'delta_credentials';
const aad = (m: CredMeta) => Buffer.from(`delta_credentials:v1:${m.keyLast4}:${m.savedAt}`);

function keyBuf(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error('SECRETS_KEY must be 64 hex characters');
  return Buffer.from(hex, 'hex');
}

export function encryptCreds(secretsKey: string, creds: Creds, meta: CredMeta): Blob {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyBuf(secretsKey), iv);
  c.setAAD(aad(meta));
  const ct = Buffer.concat([c.update(JSON.stringify(creds), 'utf8'), c.final()]);
  return { v: 1, ...meta, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

/** Throws on a wrong key or any tampering (ciphertext, IV, tag, keyLast4 or savedAt). */
export function decryptCreds(secretsKey: string, b: Blob): Creds {
  const d = createDecipheriv('aes-256-gcm', keyBuf(secretsKey), Buffer.from(b.iv, 'base64'));
  d.setAAD(aad({ keyLast4: b.keyLast4, savedAt: b.savedAt }));
  d.setAuthTag(Buffer.from(b.tag, 'base64'));
  const pt = Buffer.concat([d.update(Buffer.from(b.ct, 'base64')), d.final()]).toString('utf8');
  const o = JSON.parse(pt) as Creds;
  if (typeof o.apiKey !== 'string' || typeof o.apiSecret !== 'string') throw new Error('malformed credentials');
  return o;
}

export function storeCreds(repo: Repo, secretsKey: string, creds: Creds, now: number): CredMeta {
  const meta: CredMeta = { keyLast4: creds.apiKey.slice(-4), savedAt: now };
  repo.kvSet(KV, JSON.stringify(encryptCreds(secretsKey, creds, meta)));
  return meta;
}

export function deleteStoredCreds(repo: Repo): void {
  repo.kvSet(KV, null);
}

export function readStoredCreds(repo: Repo, secretsKey: string | undefined): StoredCreds {
  const raw = repo.kvGet(KV);
  if (raw === null) return { status: 'none' };
  let b: Blob;
  try {
    b = JSON.parse(raw) as Blob;
  } catch {
    return { status: 'unreadable', meta: null, reason: 'stored credentials are corrupt' };
  }
  const meta = { keyLast4: String(b.keyLast4 ?? ''), savedAt: Number(b.savedAt ?? 0) };
  if (!secretsKey) return { status: 'unreadable', meta, reason: 'SECRETS_KEY is not set' };
  try {
    return { status: 'ok', creds: decryptCreds(secretsKey, b), meta };
  } catch {
    return { status: 'unreadable', meta, reason: 'cannot decrypt (wrong SECRETS_KEY or tampered data)' };
  }
}
