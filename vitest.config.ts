import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only service unit tests. `app/routes/api.supplier.test.tsx` is a ROUTE
    // (URL /api/supplier/test), not a test file, so routes are excluded.
    include: ["app/services/**/*.test.ts"],
    // shopify.server.ts throws on import without these; tests never call Shopify.
    env: {
      SHOPIFY_APP_URL: "https://test.invalid",
      SHOPIFY_API_KEY: "test",
      SHOPIFY_API_SECRET: "test",
      SCOPES: "write_products",
      DATABASE_URL: "postgresql://test:test@localhost:5432/test",
    },
  },
});
