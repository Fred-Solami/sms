# SMS Service Provider

A self-hosted SMS backend written in TypeScript and Node.js. It accepts outbound message submissions via a CLI, queues them in PostgreSQL, and delivers them to carriers using either the SMPP protocol or the TextBelt HTTP API. Inbound messages and delivery receipts received over SMPP are stored in the same database.

There is no HTTP API surface. External systems cannot submit messages over a network at this time. The only submission interface is the CLI tool.

---

## Prerequisites

- Node.js 18 or later
- PostgreSQL 12 or later, running locally or accessible over the network
- One of the following for delivery:
  - An SMPP account from a carrier or aggregator, **or**
  - A TextBelt API key from [textbelt.com](https://textbelt.com)

---

## Installation

```bash
git clone <repo-url>
cd SMS
npm install
```

---

## Configuration

Copy `.env.example` to `.env` and fill in the required values. See [docs/configuration.md](docs/configuration.md) for the full reference.

The minimum required variables depend on which delivery mode you choose.

**SMPP mode:**
```
SMS_PROVIDER=smpp
DATABASE_URL=postgresql://user:password@localhost:5432/sms_provider
SMPP_HOST=your.carrier.host
SMPP_PORT=2775
SMPP_SYSTEM_ID=your_system_id
SMPP_PASSWORD=your_password
```

**TextBelt mode:**
```
SMS_PROVIDER=textbelt
DATABASE_URL=postgresql://user:password@localhost:5432/sms_provider
TEXTBELT_API_KEY=your_api_key
```

TextBelt is a paid HTTP API. The free tier allows one SMS per day using the key `textbelt`. Purchase credits at [textbelt.com](https://textbelt.com).

---

## Database Setup

Create the database and initialize the schema:

```bash
psql -U postgres -c "CREATE DATABASE sms_provider;"
npm run db:init
```

The schema creates three tables (`messages`, `delivery_receipts`, `smpp_connections`) and the required PostgreSQL enum types. See [docs/database.md](docs/database.md) for the full schema.

---

## Running the Service

Development mode (ts-node, no compile step):
```bash
npm run dev
```

Production mode (compile first, then run):
```bash
npm run build
npm start
```

The process connects to PostgreSQL, loads any `QUEUED` messages from the database into the in-memory queue, then connects to the configured SMS gateway. The transmission loop runs inside the same process.

The in-memory queue is **volatile**. If the process exits while messages are in the `QUEUED` state in the database but not yet sent, they are reloaded from the database on the next startup. Messages dequeued but not yet written back will be reprocessed.

---

## CLI

The CLI is the only way to submit messages or query status:

```bash
# Submit an outbound message
npm run cli send <from_e164> <to_e164> "<message text>"

# Check database and queue health
npm run cli status

# List messages (optionally filter by status)
npm run cli messages [queued|sent|delivered|failed]
```

All phone numbers must be in E.164 format (e.g. `+12025551234`).

See [docs/cli.md](docs/cli.md) for full usage.

---

## Local SMPP Test Server

A local SMPP server is included for development and testing. It accepts connections, acknowledges `submit_sm` PDUs, and sends a simulated `DELIVRD` receipt back after 3 seconds.

```bash
npm run smpp:server
```

Configure your `.env` to point at it:
```
SMS_PROVIDER=smpp
SMPP_HOST=localhost
SMPP_PORT=2775
SMPP_SYSTEM_ID=test
SMPP_PASSWORD=test
```

See [docs/smpp.md](docs/smpp.md) for details.

---

## Testing

```bash
npm test
npm run test:coverage
```

There are 37 unit tests covering the validation utilities and the database layer (with a mocked pg Pool). There are no integration tests against a live database or carrier.

---

## What Is Not Implemented

The following are known gaps, not planned features hidden in a roadmap:

- No HTTP API. There is no web server. External services cannot submit messages without code changes.
- Inbound messages received over SMPP are stored in the database but not forwarded anywhere. Webhook delivery is not implemented.
- No message segmentation. Messages longer than 160 GSM-7 characters or 70 UCS-2 characters are rejected at validation. Multipart SMS is not supported.
- No authentication or authorization on the CLI or any internal API surface.
- No rate limiting on submissions.
- No horizontal scaling. The queue is in-process memory. Running multiple instances would result in duplicate delivery.

---

## Project Structure

```
src/
  index.ts                 - Application entry point and startup sequence
  config.ts                - Environment variable loading and validation
  cli.ts                   - CLI tool (send, status, messages commands)
  inbound/
    handler.ts             - Stores inbound SMPP messages in the database
  processing/
    submissionApi.ts       - Validates and enqueues outbound messages
    transmission.ts        - Dequeues and sends messages in a polling loop
    deliveryTracker.ts     - Parses and stores SMPP delivery receipts
  queue/
    messageQueue.ts        - In-memory queue with O(1) enqueue/dequeue
  smpp/
    client.ts              - SMPP client (connect, bind, submit, reconnect)
    textbeltAdapter.ts     - TextBelt HTTP API adapter
    smsClientFactory.ts    - Selects client based on SMS_PROVIDER config
    testServer.ts          - Local SMPP server for development testing
  storage/
    messageStore.ts        - PostgreSQL queries (pg Pool)
    models.ts              - TypeScript interfaces and enums
  types/
    smpp.d.ts              - Type declarations for the smpp npm package
  utils/
    logger.ts              - Winston logger (console + file transports)
    validation.ts          - Phone number and GSM-7/UCS-2 content validation

scripts/
  schema.sql               - Database schema DDL
  init-db.ts               - Runs schema.sql against the configured database

tests/
  unit/
    validation.test.ts     - Tests for validation utilities
    messageStore.test.ts   - Tests for MessageStore with mocked pg Pool
  setup.ts                 - Silences Winston during test runs

docs/
  architecture.md          - How the components connect at runtime
  configuration.md         - All environment variables with types and defaults
  database.md              - Schema description and index rationale
  smpp.md                  - SMPP setup, the test server, and carrier requirements
  textbelt.md              - TextBelt API setup and limitations
  cli.md                   - CLI command reference
```

---

## License

MIT

