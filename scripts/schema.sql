-- SMS Service Provider Database Schema

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Message direction enum
CREATE TYPE message_direction AS ENUM ('outbound', 'inbound');

-- Message status enum
CREATE TYPE message_status AS ENUM (
  'queued',
  'sent',
  'delivered',
  'failed',
  'rejected',
  'expired'
);

-- Connection status enum
CREATE TYPE connection_status AS ENUM (
  'disconnected',
  'connecting',
  'connected',
  'bound',
  'error',
  'reconnecting'
);

-- Bind mode enum
CREATE TYPE bind_mode AS ENUM ('transmitter', 'receiver', 'transceiver');

-- Messages table
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  direction message_direction NOT NULL,
  from_number VARCHAR(20) NOT NULL,
  to_number VARCHAR(20) NOT NULL,
  content TEXT NOT NULL,
  status message_status NOT NULL DEFAULT 'queued',
  smpp_message_id VARCHAR(255),
  carrier_receipt TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_code INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  queued_at TIMESTAMP WITH TIME ZONE,
  sent_at TIMESTAMP WITH TIME ZONE,
  delivered_at TIMESTAMP WITH TIME ZONE,
  failed_at TIMESTAMP WITH TIME ZONE,
  
  -- Constraints
  CONSTRAINT valid_phone_numbers CHECK (
    from_number ~ '^\+[1-9]\d{1,14}$' AND
    to_number ~ '^\+[1-9]\d{1,14}$'
  ),
  CONSTRAINT valid_retry_count CHECK (retry_count >= 0 AND retry_count <= 10),
  CONSTRAINT valid_content_length CHECK (length(content) > 0 AND length(content) <= 1000)
);

-- Indexes for messages table
CREATE INDEX idx_messages_status ON messages(status);
CREATE INDEX idx_messages_direction ON messages(direction);
CREATE INDEX idx_messages_from_number ON messages(from_number);
CREATE INDEX idx_messages_to_number ON messages(to_number);
CREATE INDEX idx_messages_created_at ON messages(created_at);
CREATE INDEX idx_messages_smpp_message_id ON messages(smpp_message_id) WHERE smpp_message_id IS NOT NULL;
CREATE INDEX idx_messages_status_created ON messages(status, created_at);

-- Delivery receipts table
CREATE TABLE delivery_receipts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  carrier_message_id VARCHAR(255) NOT NULL,
  delivery_status VARCHAR(50) NOT NULL,
  error_code INTEGER,
  submit_date TIMESTAMP WITH TIME ZONE,
  done_date TIMESTAMP WITH TIME ZONE,
  text TEXT,
  received_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT unique_carrier_message_id UNIQUE (carrier_message_id, received_at)
);

-- Indexes for delivery_receipts table
CREATE INDEX idx_delivery_receipts_message_id ON delivery_receipts(message_id);
CREATE INDEX idx_delivery_receipts_carrier_message_id ON delivery_receipts(carrier_message_id);
CREATE INDEX idx_delivery_receipts_received_at ON delivery_receipts(received_at);

-- SMPP connections table
CREATE TABLE smpp_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host VARCHAR(255) NOT NULL,
  port INTEGER NOT NULL,
  system_id VARCHAR(255) NOT NULL,
  password VARCHAR(255) NOT NULL,
  system_type VARCHAR(255),
  bind_mode bind_mode NOT NULL DEFAULT 'transceiver',
  status connection_status NOT NULL DEFAULT 'disconnected',
  session_id VARCHAR(255),
  connected_at TIMESTAMP WITH TIME ZONE,
  last_activity_at TIMESTAMP WITH TIME ZONE,
  reconnect_attempts INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT valid_port CHECK (port > 0 AND port <= 65535),
  CONSTRAINT valid_reconnect_attempts CHECK (reconnect_attempts >= 0)
);

-- Index for smpp_connections table
CREATE INDEX idx_smpp_connections_status ON smpp_connections(status);
CREATE INDEX idx_smpp_connections_last_activity ON smpp_connections(last_activity_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_smpp_connections_updated_at
  BEFORE UPDATE ON smpp_connections
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Comments for documentation
COMMENT ON TABLE messages IS 'Stores all SMS messages (inbound and outbound) with full lifecycle tracking';
COMMENT ON TABLE delivery_receipts IS 'Stores delivery receipts received from carrier for outbound messages';
COMMENT ON TABLE smpp_connections IS 'Tracks SMPP connection state and history';

COMMENT ON COLUMN messages.smpp_message_id IS 'Carrier-assigned message ID from submit_sm_resp';
COMMENT ON COLUMN messages.carrier_receipt IS 'Raw delivery receipt text from carrier';
COMMENT ON COLUMN messages.retry_count IS 'Number of retry attempts for failed messages';

-- Grant permissions (adjust user as needed)
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO sms_user;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sms_user;
