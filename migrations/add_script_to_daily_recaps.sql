-- Add script column to daily_recaps table for storing TTS-ready standup scripts
ALTER TABLE daily_recaps 
ADD COLUMN IF NOT EXISTS script TEXT;

-- Add comment to explain the column
COMMENT ON COLUMN daily_recaps.script IS 'Auto-generated spoken script for TTS playback (e.g., ElevenLabs). Generated automatically when a recap is submitted.';

