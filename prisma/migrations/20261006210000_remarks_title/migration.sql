-- AlterTable
ALTER TABLE "ShopSettings" ALTER COLUMN "titleTemplate" SET DEFAULT '{remarks}';

-- Shops still on the previous default move to the supplier's description;
-- a template the merchant customised is left alone.
UPDATE "ShopSettings"
SET "titleTemplate" = '{remarks}'
WHERE "titleTemplate" = '{diaWt}ct {shape} Lab Grown Diamond {jewelryType} {category} in {metal}';
