-- Enable database-generated UUIDs for upcoming domain schemas without
-- introducing domain tables before their implementing phases.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
