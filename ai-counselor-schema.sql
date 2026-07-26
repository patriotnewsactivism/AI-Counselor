-- AI-Counselor schema — Railway Postgres
-- Generated directly from lib/db/src/schema/*.ts (Drizzle) in patriotnewsactivism/AI-Counselor
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS profiles (
  user_id                  text PRIMARY KEY,
  preferred_name           text,
  companion_name           text NOT NULL DEFAULT 'Clara',
  history_pin_hash         text,
  phone_access_code_hash   text,
  keyword_mode_enabled     boolean NOT NULL DEFAULT false,
  keyword_word             text NOT NULL DEFAULT 'over',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS phone_access_code_hash text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS keyword_mode_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS keyword_word text NOT NULL DEFAULT 'over';

CREATE TABLE IF NOT EXISTS conversations (
  id          serial PRIMARY KEY,
  user_id     text NOT NULL,
  title       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_conversations_user_id ON conversations(user_id);

CREATE TABLE IF NOT EXISTS messages (
  id                serial PRIMARY KEY,
  conversation_id   integer NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              text NOT NULL CHECK (role IN ('user','assistant')),
  content           text NOT NULL,
  audio_mime_type   text,
  speaker_name      text,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS memories (
  id          serial PRIMARY KEY,
  user_id     text NOT NULL,
  content     text NOT NULL,
  category    text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_memories_user_id ON memories(user_id);

CREATE TABLE IF NOT EXISTS voice_profiles (
  id                serial PRIMARY KEY,
  user_id           text NOT NULL,
  name              text NOT NULL,
  sample_audio      text NOT NULL,
  sample_mime_type  text NOT NULL,
  last_heard_at     timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_voice_profiles_user_id ON voice_profiles(user_id);

-- Verification
SELECT table_name FROM information_schema.tables
WHERE table_schema='public'
AND table_name IN ('profiles','conversations','messages','memories','voice_profiles')
ORDER BY table_name;
