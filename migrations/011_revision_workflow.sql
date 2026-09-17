-- Migration 011: Enhance revision workflow, review state machine, and voice notes

-- 1. Update versions.status check constraint to support REVISION_REQUESTED
ALTER TABLE versions DROP CONSTRAINT IF EXISTS versions_status_check;
ALTER TABLE versions ADD CONSTRAINT versions_status_check CHECK (status IN ('PENDING', 'REVISION_REQUESTED', 'APPROVED'));

-- 2. Add voice note support to revisions
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS file_id bigint REFERENCES files(id) ON DELETE SET NULL;
ALTER TABLE revisions ADD COLUMN IF NOT EXISTS duration integer DEFAULT 0;

-- 3. Make request optional if voice file_id is provided
ALTER TABLE revisions ALTER COLUMN request DROP NOT NULL;
ALTER TABLE revisions DROP CONSTRAINT IF EXISTS revisions_request_check;
ALTER TABLE revisions ADD CONSTRAINT revisions_request_check CHECK ((request IS NOT NULL AND length(trim(request)) >= 3) OR file_id IS NOT NULL);

-- 4. Add structured references to messages table
ALTER TABLE messages ADD COLUMN IF NOT EXISTS revision_id bigint REFERENCES revisions(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS version_id bigint REFERENCES versions(id) ON DELETE SET NULL;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS option_id bigint REFERENCES design_options(id) ON DELETE SET NULL;

-- 5. Expand messages type check to support REVISION
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;
ALTER TABLE messages ADD CONSTRAINT messages_type_check CHECK (type IN ('TEXT', 'AUDIO', 'IMAGE', 'FILE', 'REVISION'));

-- 6. Indexes for performant lookup
CREATE INDEX IF NOT EXISTS revisions_version_idx ON revisions(version_id);
CREATE INDEX IF NOT EXISTS revisions_file_idx ON revisions(file_id) WHERE file_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_revision_idx ON messages(revision_id) WHERE revision_id IS NOT NULL;
