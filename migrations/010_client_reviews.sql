CREATE TABLE IF NOT EXISTS reviews (
    id BIGSERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
    client_id INTEGER REFERENCES clients(id) ON DELETE SET NULL,
    designer_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    rating SMALLINT NOT NULL CHECK (rating >= 1 AND rating <= 5),
    comment TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_reviews_project_id ON reviews(project_id);
CREATE INDEX IF NOT EXISTS idx_reviews_designer_id ON reviews(designer_id);
