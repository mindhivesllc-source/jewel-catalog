import { describe, it, expect, beforeAll } from "vitest";
import { decryptSecret, encryptSecret, isEncrypted } from "./crypto.server";

beforeAll(() => {
  process.env.ENCRYPTION_KEY = "test-key";
});

describe("secret encryption", () => {
  it("round-trips", () => {
    const enc = encryptSecret("shpat_abc123");
    expect(isEncrypted(enc)).toBe(true);
    expect(enc).not.toContain("shpat_abc123");
    expect(decryptSecret(enc)).toBe("shpat_abc123");
  });
  it("uses a fresh IV per call", () => {
    expect(encryptSecret("x")).not.toBe(encryptSecret("x"));
  });
  it("passes legacy plaintext through", () => {
    expect(decryptSecret("legacy-key")).toBe("legacy-key");
  });
  it("does not double-encrypt", () => {
    const enc = encryptSecret("k");
    expect(encryptSecret(enc)).toBe(enc);
  });
  it("returns empty for tampered or foreign ciphertext", () => {
    const enc = encryptSecret("k");
    expect(decryptSecret(enc.slice(0, -4) + "AAAA")).toBe("");
    expect(decryptSecret("enc:v1:garbage")).toBe("");
  });
  it("handles empty values", () => {
    expect(encryptSecret("")).toBe("");
    expect(decryptSecret(null)).toBe("");
  });
});
