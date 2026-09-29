import { describe, it, expect, beforeAll } from "vitest";
import { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { EncryptedSessionStorage } from "./encrypted-session-storage.server";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key";
});

class MemoryStorage implements SessionStorage {
  rows = new Map<string, Session>();
  async storeSession(s: Session) { this.rows.set(s.id, s); return true; }
  async loadSession(id: string) { return this.rows.get(id); }
  async deleteSession(id: string) { return this.rows.delete(id); }
  async deleteSessions(ids: string[]) { ids.forEach((i) => this.rows.delete(i)); return true; }
  async findSessionsByShop(shop: string) {
    return [...this.rows.values()].filter((s) => s.shop === shop);
  }
}

const make = (token = "shpat_secret") =>
  new Session({
    id: "offline_a.myshopify.com",
    shop: "a.myshopify.com",
    state: "s",
    isOnline: false,
    accessToken: token,
    scope: "read_products",
  });

describe("EncryptedSessionStorage", () => {
  it("stores ciphertext and loads plaintext", async () => {
    const inner = new MemoryStorage();
    const storage = new EncryptedSessionStorage(inner);
    const original = make();
    await storage.storeSession(original);

    expect(inner.rows.get(original.id)?.accessToken).toMatch(/^enc:v1:/);
    expect(original.accessToken).toBe("shpat_secret");

    const loaded = await storage.loadSession(original.id);
    expect(loaded?.accessToken).toBe("shpat_secret");
    expect(loaded).toBeInstanceOf(Session);
    expect(loaded?.scope).toBe("read_products");
  });

  it("reads rows stored before encryption", async () => {
    const inner = new MemoryStorage();
    await inner.storeSession(make("legacy_plain"));
    const storage = new EncryptedSessionStorage(inner);
    expect((await storage.loadSession("offline_a.myshopify.com"))?.accessToken).toBe("legacy_plain");
    expect((await storage.findSessionsByShop("a.myshopify.com"))[0].accessToken).toBe("legacy_plain");
  });

  it("treats an undecryptable token as no session", async () => {
    const inner = new MemoryStorage();
    await inner.storeSession(make("enc:v1:broken"));
    const storage = new EncryptedSessionStorage(inner);
    expect(await storage.loadSession("offline_a.myshopify.com")).toBeUndefined();
    expect(await storage.findSessionsByShop("a.myshopify.com")).toEqual([]);
  });
});
