-- Create a new table to store generated scripts
CREATE TABLE IF NOT EXISTS daily_recap_scripts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  recap_id UUID REFERENCES daily_recaps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  script_text TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Ensure one script per recap (optional, remove if you want multiple versions)
  CONSTRAINT unique_script_per_recap UNIQUE (recap_id)
);

-- Add comments
COMMENT ON TABLE daily_recap_scripts IS 'Stores AI-generated scripts for TTS derived from daily recaps';
COMMENT ON COLUMN daily_recap_scripts.recap_id IS 'Foreign key to the daily_recaps table';
COMMENT ON COLUMN daily_recap_scripts.script_text IS 'The generated text script for TTS';

