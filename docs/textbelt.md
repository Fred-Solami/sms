# TextBelt

## What TextBelt Is

TextBelt (textbelt.com) is a paid SMS API. It accepts HTTP POST requests and delivers SMS to the destination number. It is not email-to-SMS and it is not free beyond one message per day.

---

## Pricing

- Free tier: one SMS per day using the API key `textbelt` (the literal string).
- Paid tier: credits purchased at textbelt.com. As of writing, $3 for 50 messages ($0.06 each). Check the site for current pricing.

There is no monthly subscription model. Credits are prepaid and do not expire.

---

## Configuration

```
SMS_PROVIDER=textbelt
TEXTBELT_API_KEY=textbelt
```

Replace `textbelt` with your purchased API key when you have one.

The `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, and `SMTP_FROM` environment variables appear in `config.ts` but are not used. The TextBelt adapter does not send email and does not use SMTP. Those variables are dead configuration.

---

## How It Works

The `TextBeltAdapter` sends an HTTP POST to `https://textbelt.com/text` with a JSON body containing the destination phone number, message text, and API key. It sets a 10-second timeout using `AbortSignal.timeout`. On success the API returns a `textId` which is stored as `smpp_message_id` in the database.

TextBelt does not support inbound messages or delivery receipts via this integration. The delivery tracker and inbound handler only apply to the SMPP path.

---

## Limitations

- No delivery receipts. Messages sent via TextBelt are marked `sent` when the API returns success. They are never automatically updated to `delivered`.
- No inbound SMS. TextBelt does not provide a way to receive messages.
- Phone number format: TextBelt accepts E.164 format (e.g. `+12025551234`). This service validates and requires E.164 before submitting.
- Carrier support varies by country. Check textbelt.com for the list of supported carriers and regions.
- The from number is not configurable through this integration. TextBelt assigns its own sender ID.
