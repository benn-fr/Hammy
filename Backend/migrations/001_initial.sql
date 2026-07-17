CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE device_platform AS ENUM ('ios', 'macos', 'bridge');
CREATE TYPE device_trust_state AS ENUM ('pending', 'trusted', 'revoked');
CREATE TYPE notification_hint AS ENUM ('none', 'generic', 'attention');

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_email_normalized CHECK (email = lower(email))
);

CREATE UNIQUE INDEX users_email_unique ON users (lower(email));

CREATE TABLE devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  platform device_platform NOT NULL,
  agreement_public_key text NOT NULL,
  signing_public_key text NOT NULL,
  trust_state device_trust_state NOT NULL,
  approved_by_device_id uuid REFERENCES devices(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz,
  revoked_at timestamptz,
  CONSTRAINT devices_agreement_key_unique UNIQUE (user_id, agreement_public_key),
  CONSTRAINT devices_signing_key_unique UNIQUE (user_id, signing_public_key),
  CONSTRAINT devices_trust_dates CHECK (
    (trust_state = 'pending' AND approved_at IS NULL AND revoked_at IS NULL)
    OR (trust_state = 'trusted' AND approved_at IS NOT NULL AND revoked_at IS NULL)
    OR (trust_state = 'revoked' AND revoked_at IS NOT NULL)
  )
);

CREATE INDEX devices_user_state_idx ON devices (user_id, trust_state);

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  refresh_token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_rotated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX auth_sessions_device_active_idx ON auth_sessions (device_id, expires_at) WHERE revoked_at IS NULL;

CREATE TABLE login_challenges (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  challenge_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE INDEX login_challenges_expiry_idx ON login_challenges (expires_at) WHERE used_at IS NULL;

CREATE TABLE relay_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_device_id uuid NOT NULL REFERENCES devices(id),
  encrypted_metadata jsonb NOT NULL,
  active_key_id text NOT NULL,
  key_epoch integer NOT NULL DEFAULT 1 CHECK (key_epoch >= 1),
  key_rotation_required boolean NOT NULL DEFAULT false,
  key_rotation_required_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  CONSTRAINT relay_sessions_rotation_time CHECK (
    (key_rotation_required = false AND key_rotation_required_at IS NULL)
    OR (key_rotation_required = true AND key_rotation_required_at IS NOT NULL)
  )
);

CREATE INDEX relay_sessions_user_updated_idx ON relay_sessions (user_id, updated_at DESC);

CREATE TABLE session_key_epochs (
  session_id uuid NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key_id text NOT NULL,
  key_epoch integer NOT NULL CHECK (key_epoch >= 1),
  activated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, key_epoch),
  CONSTRAINT session_key_epochs_key_unique UNIQUE (session_id, key_id)
);

CREATE TABLE key_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
  sender_device_id uuid NOT NULL REFERENCES devices(id),
  recipient_device_id uuid NOT NULL REFERENCES devices(id),
  key_id text NOT NULL,
  envelope jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT key_packages_recipient_key_unique UNIQUE (session_id, recipient_device_id, key_id)
);

CREATE INDEX key_packages_recipient_idx ON key_packages (user_id, recipient_device_id, created_at);

CREATE TABLE encrypted_events (
  cursor bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES relay_sessions(id) ON DELETE CASCADE,
  sender_device_id uuid NOT NULL REFERENCES devices(id),
  notification_hint notification_hint NOT NULL DEFAULT 'none',
  key_id text NOT NULL,
  nonce text NOT NULL,
  envelope jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT encrypted_events_user_message_key UNIQUE (user_id, message_id),
  CONSTRAINT encrypted_events_session_nonce_key UNIQUE (session_id, key_id, nonce)
);

CREATE INDEX encrypted_events_user_cursor_idx ON encrypted_events (user_id, cursor);
CREATE INDEX encrypted_events_session_cursor_idx ON encrypted_events (session_id, cursor);

ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE devices FORCE ROW LEVEL SECURITY;
CREATE POLICY devices_tenant_policy ON devices
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE relay_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE relay_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY relay_sessions_tenant_policy ON relay_sessions
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE key_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE key_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY key_packages_tenant_policy ON key_packages
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE session_key_epochs ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_key_epochs FORCE ROW LEVEL SECURITY;
CREATE POLICY session_key_epochs_tenant_policy ON session_key_epochs
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

ALTER TABLE encrypted_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE encrypted_events FORCE ROW LEVEL SECURITY;
CREATE POLICY encrypted_events_tenant_policy ON encrypted_events
  USING (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid)
  WITH CHECK (user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid);
