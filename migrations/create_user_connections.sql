-- Create user_connections table to store OAuth tokens and GitHub tokens
CREATE TABLE IF NOT EXISTS user_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  slack_user_id TEXT NOT NULL,
  team_id TEXT,
  google_tokens JSONB,
  github_token TEXT,
  github_owner TEXT,
  github_repo TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(slack_user_id, team_id)
);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_connections_slack_user_id ON user_connections(slack_user_id, team_id);

-- Add updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_user_connections_updated_at BEFORE UPDATE ON user_connections
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

