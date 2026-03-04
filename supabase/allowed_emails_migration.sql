-- allowed_emails - admin whitelist for who can sign up
CREATE TABLE allowed_emails (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  added_by TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE allowed_emails ENABLE ROW LEVEL SECURITY;

-- Allow anyone (including anon) to check if their email exists
CREATE POLICY "Allow email lookup" ON allowed_emails
  FOR SELECT USING (true);
