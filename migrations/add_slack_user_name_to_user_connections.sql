-- Add slack_user_name column to user_connections table
ALTER TABLE user_connections 
ADD COLUMN IF NOT EXISTS slack_user_name TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN user_connections.slack_user_name IS 'Display name of the Slack user';

