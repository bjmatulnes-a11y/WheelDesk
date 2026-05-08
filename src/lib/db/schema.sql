CREATE TABLE waitlist_entries (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  source TEXT,
  notes TEXT
);
