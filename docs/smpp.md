# SMPP

## What SMPP Is

Short Message Peer-to-Peer (SMPP) is a TCP-based protocol used between SMS application servers and mobile carrier infrastructure (SMSCs). It is the standard way to send high-volume SMS directly without going through a third-party HTTP API.

This service connects as an ESME (External Short Message Entity) to an SMPP gateway operated by a carrier or aggregator.

---

## Getting SMPP Credentials

SMPP access is not publicly available. You need an account with a carrier or SMS aggregator that offers SMPP connectivity. Examples of providers that offer SMPP:

- Twilio (SMPP interface available on some plans)
- Vonage (Nexmo)
- Sinch
- Bandwidth
- Your regional carrier directly (requires a formal agreement)

Typical credentials provided:

- Host (SMPP gateway hostname or IP)
- Port (usually 2775)
- System ID (username)
- Password
- System type (often blank)

---

## Configuration

```
SMS_PROVIDER=smpp
SMPP_HOST=smpp.yourcarrier.com
SMPP_PORT=2775
SMPP_SYSTEM_ID=your_system_id
SMPP_PASSWORD=your_password
SMPP_SYSTEM_TYPE=
```

---

## Connection Behaviour

The client uses `bind_transceiver` mode, which allows sending and receiving on a single connection. On bind failure or disconnection, the client schedules reconnection with exponential backoff (base 1 second, max 300 seconds). After `MAX_RECONNECT_ATTEMPTS` failed attempts, the process emits an event that triggers shutdown.

Keepalives (`enquire_link`) are sent automatically by the `smpp` library at the interval set by `KEEPALIVE_INTERVAL` (default 30 seconds).

---

## Local Test Server

A local SMPP server is provided in `src/smpp/testServer.ts` for development and integration testing without a carrier account.

Start it:

```bash
npm run smpp:server
```

Behaviour:

- Listens on `0.0.0.0:2775` by default (overridable via `TEST_SMPP_HOST` and `TEST_SMPP_PORT`).
- Accepts binds where `system_id=test` and `password=test` (overridable via `TEST_SMPP_SYSTEM_ID` and `TEST_SMPP_PASSWORD`). Rejects all other credentials with `ESME_RINVPASWD`.
- Responds to `submit_sm` with a `submit_sm_resp` containing a generated message ID (`TEST000001`, `TEST000002`, ...).
- After 3 seconds, sends a `deliver_sm` back to the client with `stat:DELIVRD` in the receipt text, if the original `submit_sm` had `registered_delivery` set. This matches the format expected by `DeliveryTracker.parseReceiptText`.
- Responds to `enquire_link` with `enquire_link_resp`.
- Responds to `unbind` with `unbind_resp` and closes the session.

Point your client at it:

```
SMS_PROVIDER=smpp
SMPP_HOST=localhost
SMPP_PORT=2775
SMPP_SYSTEM_ID=test
SMPP_PASSWORD=test
```

---

## Delivery Receipt Format

The service expects delivery receipts in the standard SMPP receipt format:

```
id:MSGID sub:001 dlvrd:001 submit date:YYMMDDHHMM done date:YYMMDDHHMM stat:DELIVRD err:000 text:...
```

The parser extracts: `id`, `sub`, `dlvrd`, `submit_date`, `done_date`, `stat`, `err`.

Carrier status values are mapped to internal statuses as follows:

| Carrier status | Internal status |
|---|---|
| `DELIVRD` | `delivered` |
| `ACCEPTD` | `sent` |
| `REJECTD` | `rejected` |
| `EXPIRED` | `failed` |
| `DELETED` | `failed` |
| `UNDELIV` | `failed` |
| `UNKNOWN` | `failed` |
| Anything else | `failed` |
