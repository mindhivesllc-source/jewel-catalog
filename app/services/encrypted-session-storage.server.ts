import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decryptSecret, encryptSecret, isEncrypted } from "./crypto.server";

const TOKEN_FIELDS = ["accessToken", "refreshToken"] as const;

function mapTokens(
  session: Session,
  transform: (value: string) => string,
): Session {
  const copy = Object.assign(
    Object.create(Object.getPrototypeOf(session)),
    session,
  ) as Session;
  const fields = copy as unknown as Record<string, unknown>;
  for (const field of TOKEN_FIELDS) {
    const value = fields[field];
    if (typeof value === "string" && value) fields[field] = transform(value);
  }
  return copy;
}

/**
 * Wraps a session storage so Shopify access/refresh tokens are encrypted at
 * rest. Rows stored before encryption was introduced are read as-is and
 * re-written encrypted on the next store.
 */
export class EncryptedSessionStorage implements SessionStorage {
  constructor(private readonly inner: SessionStorage) {}

  storeSession(session: Session): Promise<boolean> {
    return this.inner.storeSession(mapTokens(session, encryptSecret));
  }

  async loadSession(id: string): Promise<Session | undefined> {
    const session = await this.inner.loadSession(id);
    return session ? this.decrypt(session) : undefined;
  }

  deleteSession(id: string): Promise<boolean> {
    return this.inner.deleteSession(id);
  }

  deleteSessions(ids: string[]): Promise<boolean> {
    return this.inner.deleteSessions(ids);
  }

  async findSessionsByShop(shop: string): Promise<Session[]> {
    const sessions = await this.inner.findSessionsByShop(shop);
    return sessions
      .map((s) => this.decrypt(s))
      .filter((s): s is Session => s !== undefined);
  }

  /** An undecryptable token means "no session": Shopify re-authenticates. */
  private decrypt(session: Session): Session | undefined {
    const stored = session.accessToken;
    const decrypted = mapTokens(session, decryptSecret);
    if (isEncrypted(stored) && !decrypted.accessToken) return undefined;
    return decrypted;
  }
}
