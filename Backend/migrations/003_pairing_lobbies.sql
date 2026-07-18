-- A phone can safely announce an opaque, short-lived pairing lobby before it
-- has an account. The companion must know the high-entropy code before the
-- server associates the phone keys with a user.
CREATE TABLE pairing_lobbies (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  device_name text NOT NULL,
  device_platform device_platform NOT NULL,
  agreement_public_key text NOT NULL,
  signing_public_key text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  creator_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  claimed_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairing_lobbies_expiry CHECK (expires_at > created_at)
);

CREATE INDEX pairing_lobbies_open_idx ON pairing_lobbies (created_at DESC)
  WHERE claimed_device_id IS NULL AND consumed_at IS NULL;
CREATE INDEX pairing_lobbies_user_idx ON pairing_lobbies (user_id, created_at DESC);

ALTER TABLE pairing_lobbies ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairing_lobbies FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_lobbies_tenant_or_code_policy ON pairing_lobbies
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR code_hash = NULLIF(current_setting('app.pairing_code_hash', true), '')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR code_hash = NULLIF(current_setting('app.pairing_code_hash', true), '')
  );

-- A trusted companion may only learn that an opaque lobby exists. The API
-- selects ID/expiry only, and approval still requires its unguessable code.
CREATE POLICY pairing_lobbies_open_discovery_policy ON pairing_lobbies
  FOR SELECT
  USING (
    user_id IS NULL
    AND claimed_device_id IS NULL
    AND consumed_at IS NULL
    AND expires_at > now()
  );
