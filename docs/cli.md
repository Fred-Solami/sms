# CLI Reference

The CLI is the only external interface for submitting messages and querying state. It connects directly to the database and does not go through the running service process.

Because the CLI instantiates `MessageStore` and `MessageQueue` directly, the `DATABASE_URL` in your `.env` must be reachable when you run CLI commands.

The CLI does not connect to the SMS client. Submissions via the CLI write to the database and queue, but delivery only happens when the main service process is running and connected.

---

## Invocation

```bash
npm run cli <command> [arguments]
```

Or directly with ts-node:

```bash
npx ts-node src/cli.ts <command> [arguments]
```

---

## Commands

### send

Validates and submits one outbound message.

```bash
npm run cli send <from> <to> <message text>
```

Arguments:

| Argument | Description |
|---|---|
| `from` | Sender phone number in E.164 format (e.g. `+12025551234`). |
| `to` | Recipient phone number in E.164 format. |
| `message text` | Message body. Remaining arguments are joined with spaces. |

Validation applied before submission:

- Both numbers must match `^\+[1-9]\d{1,14}$` (E.164).
- Content must be non-empty.
- GSM-7 encoding is assumed. The message must fit within 160 GSM-7 septets (extended characters count as 2 septets each). Characters outside the GSM-7 basic and extended sets are rejected.

If the queue is at capacity (`QUEUE_MAX_SIZE`) the message is written to the database with status `failed` and a `Queue overflow` error message. It is not retried.

Exit code 0 on success, 1 on validation failure or internal error.

Example:

```bash
npm run cli send +12025551234 +447911123456 "Hello from the CLI"
```

### status

Prints the current health of the database and queue, and a count of messages by status.

```bash
npm run cli status
```

Output includes:

- Database reachable (yes/no).
- Queue size (total items including delayed retries).
- Queue ready count (items available to send immediately).
- Queue healthy (true if below `QUEUE_MAX_SIZE`).
- Count of messages per status: `queued`, `sent`, `delivered`, `failed`.

Because the CLI creates its own `MessageQueue` instance, the queue size shown is always 0. It reflects the CLI's local queue, not the running service's queue.

### messages

Lists messages from the database, optionally filtered by status.

```bash
npm run cli messages [status]
```

`status` is optional. If provided it must be one of: `queued`, `sent`, `delivered`, `failed`, `rejected`, `expired`.

Returns the 100 most recent matching messages ordered by `created_at` descending.
