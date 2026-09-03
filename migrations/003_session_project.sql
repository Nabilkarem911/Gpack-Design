ALTER TABLE sessions ADD COLUMN IF NOT EXISTS project_id integer REFERENCES projects(id);
