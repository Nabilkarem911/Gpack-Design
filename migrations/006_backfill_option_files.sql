WITH ranked_files AS (
  SELECT f.id, f.version_id, row_number() OVER (PARTITION BY f.version_id ORDER BY f.id) AS position
  FROM files f
  WHERE f.version_id IS NOT NULL AND f.option_id IS NULL
), ranked_options AS (
  SELECT o.id, o.version_id, row_number() OVER (PARTITION BY o.version_id ORDER BY o.id) AS position
  FROM design_options o
)
UPDATE files f
SET option_id = ro.id
FROM ranked_files rf
JOIN ranked_options ro ON ro.version_id = rf.version_id AND ro.position = rf.position
WHERE f.id = rf.id AND f.option_id IS NULL;
