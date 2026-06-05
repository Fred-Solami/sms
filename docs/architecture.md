# Architecture

## Runtime Components

The service runs as a single Node.js process. There is no clustering, no external queue, and no inter-process communication. All components share the same memory space.

```
CLI / External Code
       |
       v
MessageSubmissionAPI         (validates input, writes to DB, enqueues)
       |
       v
MessageQueue                 (in-memory, volatile, FIFO with binary-sorted delay queue)
       |
       v
MessageTransmissionLoop      (setInterval polling, processes up to 10 messages per tick)
       |
       v
SMSClient (SMPP or TextBelt)
       |
       v
Carrier / TextBelt API

SMSClient (SMPP only)
       |
       | deliver_sm events
       v
DeliveryTracker              (parses receipt, updates message status in DB)
InboundHandler               (stores inbound message in DB, no further routing)

All components
       |
       v
MessageStore                 (pg Pool, connection-pooled PostgreSQL)
```

## Startup Sequence

1. Config is validated. Invalid integer env vars throw immediately.
2. A `pg.Pool` is created and a `SELECT 1` health check is issued.
3. All messages with status `QUEUED` are loaded from PostgreSQL into the in-memory queue (limit 1000).
4. The SMS client (`SMPPClient` or `TextBeltAdapter`) is instantiated.
5. `smsClient.connect()` is called. For SMPP this opens a TCP connection and sends `bind_transceiver`. For TextBelt this is a no-op validation step.
6. On the `connected` event, `MessageTransmissionLoop.start()` is called, which starts a 100ms `setInterval`.
7. A 60-second `setInterval` logs a health summary (queue size, SMS client status, DB health).
8. The main loop runs `setTimeout(1000)` repeatedly until `SIGINT` or `SIGTERM` sets `running = false`.
9. On shutdown: transmission loop stops, SMS client disconnects, `pg.Pool` ends.

## Message Lifecycle

```
submit()         -> DB: status = QUEUED, enqueued in memory
dequeue + send() -> DB: status = SENT, smpp_message_id populated
deliver_sm recv  -> DB: status = DELIVERED or FAILED, delivery receipt row inserted
failure + retry  -> requeueWithDelay(), DB: retry_count incremented
max retries hit  -> DB: status = FAILED
```

## Queue Design

The queue is split into two structures:

- `readyQueue`: array with a head pointer. Enqueue appends, dequeue advances the pointer (O(1) amortised). The backing array is compacted when the dead head region exceeds 1000 slots.
- `delayedQueue`: array sorted ascending by `retryAfter`, maintained by binary insert (O(log n)). Before each dequeue, items whose delay has elapsed are moved to `readyQueue`.

The queue is entirely in memory. If the process is killed, any messages in the queue that have not yet been updated to `SENT` in the database remain in the `QUEUED` state and are reloaded on next startup.

## SMPP Client

Wraps the `smpp` npm package. Uses `bind_transceiver` mode (send and receive on one connection). On disconnect, it schedules a reconnect with exponential backoff (base 1s, max 300s, up to `MAX_RECONNECT_ATTEMPTS`). The auto `enquire_link` keepalive is delegated to the `smpp` library via `auto_enquire_link_period`.

## Database Layer

Uses `pg.Pool`. Pool size is `DB_POOL_SIZE + DB_MAX_OVERFLOW` connections (defaults: 10 + 20 = 30). All queries use parameterised statements. The DB health check (`SELECT 1`) runs at most once every 30 seconds, cached in the transmission loop.

## Limitations Relevant to Architecture

- Single process. Two instances running against the same database would both dequeue and send the same messages.
- No distributed lock on message consumption.
- No HTTP server. There is no network interface to accept submissions from other processes or services.
- Inbound messages are stored but not forwarded. The `InboundHandler` has a TODO where webhook delivery would go.
