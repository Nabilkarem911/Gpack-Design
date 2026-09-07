ALTER TABLE revisions ADD COLUMN IF NOT EXISTS option_id bigint REFERENCES design_options(id);
