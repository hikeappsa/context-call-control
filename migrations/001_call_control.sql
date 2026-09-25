CREATE TABLE IF NOT EXISTS call_contexts (
  context_type TEXT NOT NULL,
  context_id TEXT NOT NULL,
  participant_a TEXT NOT NULL,
  participant_b TEXT NOT NULL,
  name_a TEXT NOT NULL,
  name_b TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (context_type, context_id),
  CHECK (participant_a <> participant_b),
  CHECK (char_length(context_type) BETWEEN 1 AND 64),
  CHECK (char_length(context_id) BETWEEN 1 AND 128)
);

CREATE TABLE IF NOT EXISTS call_sessions (
  call_id UUID PRIMARY KEY,
  context_type TEXT NOT NULL,
  context_id TEXT NOT NULL,
  caller_id TEXT NOT NULL,
  callee_id TEXT NOT NULL,
  room_name TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN (
      'ringing',
      'answered',
      'connecting',
      'active',
      'declined',
      'missed',
      'cancelled',
      'ended',
      'failed'
    )
  ),
  invite_delivery_count INTEGER NOT NULL DEFAULT 0,
  start_idempotency_key TEXT,
  initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ,
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  end_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (caller_id <> callee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS call_sessions_idempotency
  ON call_sessions (caller_id, start_idempotency_key)
  WHERE start_idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS call_sessions_caller_status
  ON call_sessions (caller_id, status);

CREATE INDEX IF NOT EXISTS call_sessions_callee_status
  ON call_sessions (callee_id, status);

CREATE INDEX IF NOT EXISTS call_sessions_ring_expiry
  ON call_sessions (expires_at)
  WHERE status = 'ringing';

CREATE TABLE IF NOT EXISTS call_events (
  event_id BIGSERIAL PRIMARY KEY,
  call_id UUID NOT NULL REFERENCES call_sessions (call_id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  actor_id TEXT,
  event_data JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS call_events_call
  ON call_events (call_id, created_at);

CREATE TABLE IF NOT EXISTS device_endpoints (
  endpoint_id UUID PRIMARY KEY,
  device_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  client_kind TEXT NOT NULL,
  platform TEXT NOT NULL,
  push_provider TEXT NOT NULL,
  push_token TEXT,
  voip_token TEXT,
  apns_environment TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (device_id, client_kind),
  CHECK (push_token IS NOT NULL OR voip_token IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS device_endpoints_user_active
  ON device_endpoints (user_id, is_active);
