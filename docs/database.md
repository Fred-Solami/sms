# Database

## Setup

The database must be created manually before running `npm run db:init`:

```bash
psql -U postgres -c "CREATE DATABASE sms_provider;"
npm run db:init
```

`npm run db:init` runs `scripts/init-db.ts`, which reads `scripts/schema.sql` and executes it against the database specified in `DATABASE_URL`. If the schema objects already exist the script will fail with a "type already exists" or "relation already exists" error. There is no migration system — the init script is intended for a fresh database only.

---

## Schema

### Enum Types

| Type | Values |
|---|---|
| `message_direction` | `outbound`, `inbound` |
| `message_status` | `queued`, `sent`, `delivered`, `failed`, `rejected`, `expired` |
| `connection_status` | `disconnected`, `connecting`, `connected`, `bound`, `error`, `reconnecting` |
| `bind_mode` | `transmitter`, `receiver`, `transceiver` |

### Table: messages

Stores every outbound and inbound message. Outbound messages are inserted with status `queued` and transition through the lifecycle.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key, generated with `uuid_generate_v4()`. |
| `direction` | message_direction | `outbound` or `inbound`. |
| `from_number` | VARCHAR(20) | E.164 format enforced by a CHECK constraint. |
| `to_number` | VARCHAR(20) | E.164 format enforced by a CHECK constraint. |
| `content` | TEXT | Non-empty, max 1000 characters enforced by a CHECK constraint. |
| `status` | message_status | Defaults to `queued`. |
| `smpp_message_id` | VARCHAR(255) | The carrier-assigned message ID returned in `submit_sm_resp`. Null until sent. |
| `carrier_receipt` | TEXT | Raw delivery receipt text from the carrier. Null until a receipt is received. |
| `retry_count` | INTEGER | Starts at 0. Incremented on each failed send attempt. Max 10 enforced by CHECK constraint. |
| `error_code` | INTEGER | Carrier error code from a failed PDU or delivery receipt. |
| `error_message` | TEXT | Human-readable error description. |
| `created_at` | TIMESTAMPTZ | Set at insert time. |
| `queued_at` | TIMESTAMPTZ | Set when status is `queued`. |
| `sent_at` | TIMESTAMPTZ | Set when status transitions to `sent`. |
| `delivered_at` | TIMESTAMPTZ | Set when status transitions to `delivered`. |
| `failed_at` | TIMESTAMPTZ | Set when status transitions to `failed`, `rejected`, or `expired`. |

Indexes:
- `idx_messages_status` on `status` — used by `getMessagesByStatus` and queue reloading on startup.
- `idx_messages_created_at` on `created_at` — used for time-range queries.
- `idx_messages_from_to` on `(from_number, to_number)` — used for number-based queries.
- `idx_messages_smpp_id` on `smpp_message_id` — used by `findMessageByCarrierID` when matching delivery receipts.

### Table: delivery_receipts

One row per delivery receipt received from the carrier. A message may receive more than one receipt.

| Column | Type | Notes |
|---|---|---|
| `id` | UUID | Primary key. |
| `message_id` | UUID | Foreign key to `messages.id`. |
| `carrier_message_id` | VARCHAR(255) | The carrier's message ID from the receipt. |
| `delivery_status` | VARCHAR(50) | Raw carrier status string (e.g. `DELIVRD`, `UNDELIV`). |
| `error_code` | INTEGER | Carrier error code. |
| `submit_date` | TIMESTAMPTZ | Submit timestamp from the receipt. |
| `done_date` | TIMESTAMPTZ | Delivery timestamp from the receipt. |
| `text` | TEXT | Full raw receipt text. |
| `received_at` | TIMESTAMPTZ | When the receipt was processed by this service. |

### Table: smpp_connections

Intended to log SMPP connection state. The schema defines the table but no code currently writes to it. The SMPP client state is held entirely in memory.

---

## Connection Pooling

`MessageStore` uses a single `pg.Pool` instance for its lifetime. The pool max is `DB_POOL_SIZE + DB_MAX_OVERFLOW` (default 30). The pool is closed when `MessageStore.close()` is called during graceful shutdown.

The DB health check (`SELECT 1`) is run at startup and then cached in the transmission loop, refreshed at most once every 30 seconds.
