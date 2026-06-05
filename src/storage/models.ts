/**
 * Database models and types
 */

export enum MessageDirection {
  OUTBOUND = 'outbound',
  INBOUND = 'inbound',
}

export enum MessageStatus {
  QUEUED = 'queued',
  SENT = 'sent',
  DELIVERED = 'delivered',
  FAILED = 'failed',
  REJECTED = 'rejected',
  EXPIRED = 'expired',
}

export enum ConnectionStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  BOUND = 'bound',
  ERROR = 'error',
  RECONNECTING = 'reconnecting',
}

export enum BindMode {
  TRANSMITTER = 'transmitter',
  RECEIVER = 'receiver',
  TRANSCEIVER = 'transceiver',
}

export interface Message {
  id: string;
  direction: MessageDirection;
  from_number: string;
  to_number: string;
  content: string;
  status: MessageStatus;
  smpp_message_id: string | null;
  carrier_receipt: string | null;
  retry_count: number;
  error_code: number | null;
  error_message: string | null;
  created_at: Date;
  queued_at: Date | null;
  sent_at: Date | null;
  delivered_at: Date | null;
  failed_at: Date | null;
}

export interface DeliveryReceipt {
  id: string;
  message_id: string;
  carrier_message_id: string;
  delivery_status: string;
  error_code: number | null;
  submit_date: Date | null;
  done_date: Date | null;
  text: string;
  received_at: Date;
}

export interface SMPPConnection {
  id: string;
  host: string;
  port: number;
  system_id: string;
  password: string;
  system_type: string;
  bind_mode: BindMode;
  status: ConnectionStatus;
  session_id: string | null;
  connected_at: Date | null;
  last_activity_at: Date | null;
  reconnect_attempts: number;
  error_message: string | null;
}

export interface CreateMessageParams {
  direction: MessageDirection;
  from_number: string;
  to_number: string;
  content: string;
  status?: MessageStatus;
}

export interface UpdateMessageStatusParams {
  status: MessageStatus;
  smpp_message_id?: string;
  carrier_receipt?: string;
  error_code?: number;
  error_message?: string;
}

export interface MessageFilters {
  status?: MessageStatus;
  direction?: MessageDirection;
  from_number?: string;
  to_number?: string;
  created_after?: Date;
  created_before?: Date;
}
