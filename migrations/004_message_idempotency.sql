DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='messages_event_unique_key') THEN
    ALTER TABLE messages ADD CONSTRAINT messages_event_unique_key UNIQUE(project_id, sender_type, sender_id, client_event_id);
  END IF;
END $$;
