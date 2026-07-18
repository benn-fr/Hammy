CREATE TABLE pairings (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  creator_device_id uuid NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  claimed_device_id uuid REFERENCES devices(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  claimed_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pairings_expiry CHECK (expires_at > created_at)
);

CREATE INDEX pairings_user_created_idx ON pairings (user_id, created_at DESC);
CREATE INDEX pairings_expiry_idx ON pairings (expires_at) WHERE consumed_at IS NULL;

ALTER TABLE pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY pairings_tenant_or_code_policy ON pairings
  USING (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR code_hash = NULLIF(current_setting('app.pairing_code_hash', true), '')
  )
  WITH CHECK (
    user_id = NULLIF(current_setting('app.current_user_id', true), '')::uuid
    OR code_hash = NULLIF(current_setting('app.pairing_code_hash', true), '')
  );
