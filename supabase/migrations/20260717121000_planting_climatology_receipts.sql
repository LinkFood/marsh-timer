-- The frost computation's data-quality receipts, stored beside the numbers
-- they defend (house law: every number traceable). The guards exist because
-- the lane really needs them — MD 2004 carries a station stuck at 7F all
-- summer, fabricating July "freezes". See scripts/frost-climatology.ts.
ALTER TABLE planting_climatology ADD COLUMN IF NOT EXISTS receipts jsonb;
