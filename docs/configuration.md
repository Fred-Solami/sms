# Configuration Reference

All configuration is loaded from environment variables, optionally via a `.env` file in the project root (using `dotenv`).

Integer variables are parsed with radix 10. If a variable is set to a non-numeric value the process will throw an error at startup rather than silently passing `NaN` to downstream consumers.

---

## Database

| Variable | Required | Default | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes | `postgresql://localhost/sms_provider` | Full PostgreSQL connection string. Passwords with special characters must be URL-encoded. |
| `DB_POOL_SIZE` | No | `10` | Base connection pool size passed to `pg.Pool`. |
| `DB_MAX_OVERFLOW` | No | `20` | Additional connections allowed above the base pool size. Total max connections = `DB_POOL_SIZE + DB_MAX_OVERFLOW`. |

---

## Delivery Mode

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMS_PROVIDER` | No | `textbelt` | Either `smpp` or `textbelt`. Determines which client is instantiated at startup. |

---

## SMPP (required when SMS_PROVIDER=smpp)

| Variable | Required | Default | Description |
|---|---|---|---|
| `SMPP_HOST` | Yes | _(empty)_ | Hostname or IP of the SMPP gateway. |
| `SMPP_PORT` | No | `2775` | TCP port. Standard SMPP port is 2775. |
| `SMPP_SYSTEM_ID` | Yes | _(empty)_ | System ID provided by the carrier. |
| `SMPP_PASSWORD` | Yes | _(empty)_ | Password provided by the carrier. |
| `SMPP_SYSTEM_TYPE` | No | _(empty)_ | System type string. Most carriers leave this blank. |

---

## TextBelt (required when SMS_PROVIDER=textbelt)

| Variable | Required | Default | Description |
|---|---|---|---|
| `TEXTBELT_API_KEY` | No | `textbelt` | API key from textbelt.com. The literal string `textbelt` is the free-tier key that allows one SMS per day. |

Note: The `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` variables are present in `config.ts` but are not used by the TextBelt adapter. The TextBelt adapter calls the textbelt.com REST API directly over HTTPS and does not send email.

---

## Application Behaviour

| Variable | Required | Default | Description |
|---|---|---|---|
| `NODE_ENV` | No | `development` | Passed through; no code branch currently depends on it beyond logging. |
| `LOG_LEVEL` | No | `info` | Winston log level. Valid values: `error`, `warn`, `info`, `debug`. |
| `MAX_RETRIES` | No | `3` | Maximum number of send attempts per message before it is marked `FAILED`. |
| `QUEUE_MAX_SIZE` | No | `10000` | Maximum number of messages (ready + delayed) held in the in-memory queue. Submissions that would exceed this limit are rejected with status `FAILED`. |
| `KEEPALIVE_INTERVAL` | No | `30` | Seconds between SMPP `enquire_link` keepalives. Passed to the `smpp` library as milliseconds. Has no effect in TextBelt mode. |
| `MAX_RECONNECT_ATTEMPTS` | No | `10` | Maximum SMPP reconnection attempts before the process shuts down. Has no effect in TextBelt mode. |

---

## Backoff

The reconnection delay and retry delay both use exponential backoff: `min(baseDelay * 2^attempt, maxDelay)`. These values are hardcoded in `config.ts` and not configurable via environment variables:

- Base delay: 1 second
- Maximum delay: 300 seconds (5 minutes)
