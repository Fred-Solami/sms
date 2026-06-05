/**
 * SMPP Test Server
 *
 * A local SMPP server for development and integration testing.
 * It accepts bind requests, acknowledges submit_sm PDUs, and
 * sends simulated delivery receipts back after a short delay.
 *
 * Usage:
 *   npx ts-node src/smpp/testServer.ts
 *
 * Configure your client to point at:
 *   SMPP_HOST=localhost
 *   SMPP_PORT=2775
 *   SMPP_SYSTEM_ID=test
 *   SMPP_PASSWORD=test
 */

import * as smpp from 'smpp';
import { getLogger } from '../utils/logger';

const logger = getLogger('SMPPTestServer');

const HOST = process.env.TEST_SMPP_HOST || '0.0.0.0';
const PORT = parseInt(process.env.TEST_SMPP_PORT || '2775', 10);
const SYSTEM_ID = process.env.TEST_SMPP_SYSTEM_ID || 'test';
const PASSWORD = process.env.TEST_SMPP_PASSWORD || 'test';

/** Milliseconds before a simulated delivery receipt is sent back. */
const DELIVERY_RECEIPT_DELAY_MS = 3_000;

let messageCounter = 0;

/**
 * Build an SMPP delivery-receipt short_message string.
 * The format matches what real carriers send and what DeliveryTracker.parseReceiptText expects.
 */
function buildReceiptText(msgId: string, to: string): string {
  const now = new Date();
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-T:.Z]/g, '')
      .slice(2, 12); // YYMMDDHHmm

  return (
    `id:${msgId} sub:001 dlvrd:001 ` +
    `submit date:${fmt(now)} done date:${fmt(now)} ` +
    `stat:DELIVRD err:000 text:${to.slice(-10)}`
  );
}

const server = smpp.createServer((session: any) => {
  const remoteAddr = `${session.socket?.remoteAddress}:${session.socket?.remotePort}`;
  logger.info('New SMPP connection', { remote: remoteAddr });

  // ── bind_transceiver / bind_transmitter / bind_receiver ──────────────────
  const handleBind = (pdu: any) => {
    const providedSystemId: string = pdu.system_id || '';
    const providedPassword: string = pdu.password || '';

    if (providedSystemId !== SYSTEM_ID || providedPassword !== PASSWORD) {
      logger.warn('Bind rejected — wrong credentials', {
        systemId: providedSystemId,
        remote: remoteAddr,
      });
      session.send(pdu.response({ command_status: 0x0000000d })); // ESME_RINVPASWD
      return;
    }

    logger.info('Bind accepted', { systemId: providedSystemId, remote: remoteAddr });
    session.send(pdu.response({ system_id: SYSTEM_ID }));
  };

  session.on('bind_transceiver', handleBind);
  session.on('bind_transmitter', handleBind);
  session.on('bind_receiver', handleBind);

  // ── submit_sm ─────────────────────────────────────────────────────────────
  session.on('submit_sm', (pdu: any) => {
    const msgId = `TEST${String(++messageCounter).padStart(6, '0')}`;
    const from: string = pdu.source_addr || '';
    const to: string = pdu.destination_addr || '';
    const text =
      typeof pdu.short_message === 'string'
        ? pdu.short_message
        : pdu.short_message?.message ?? '';

    logger.info('Message received', { msgId, from, to, textLength: text.length });

    // Acknowledge immediately
    session.send(pdu.response({ message_id: msgId }));

    // Simulate a delivery receipt after a delay (only when registered_delivery is set)
    if (pdu.registered_delivery & 0x01) {
      setTimeout(() => {
        if (session.socket?.destroyed) return; // session already gone

        const receiptText = buildReceiptText(msgId, to);
        logger.info('Sending simulated delivery receipt', { msgId, to });

        session.deliver_sm({
          source_addr: to,
          destination_addr: from,
          esm_class: 0x04, // delivery receipt flag
          short_message: receiptText,
        });
      }, DELIVERY_RECEIPT_DELAY_MS);
    }
  });

  // ── enquire_link (keepalive) ───────────────────────────────────────────────
  session.on('enquire_link', (pdu: any) => {
    session.send(pdu.response());
  });

  // ── unbind ────────────────────────────────────────────────────────────────
  session.on('unbind', (pdu: any) => {
    logger.info('Unbind request received', { remote: remoteAddr });
    session.send(pdu.response());
    session.close();
  });

  // ── connection close / error ───────────────────────────────────────────────
  session.on('close', () => {
    logger.info('SMPP session closed', { remote: remoteAddr });
  });

  session.on('error', (err: Error) => {
    logger.error('SMPP session error', { remote: remoteAddr, error: err.message });
  });
});

server.listen(PORT, HOST, () => {
  logger.info(`SMPP test server listening on ${HOST}:${PORT}`);
  logger.info(`Accepting credentials — system_id: "${SYSTEM_ID}", password: "${PASSWORD}"`);
  logger.info(`Delivery receipts will be sent after ${DELIVERY_RECEIPT_DELAY_MS / 1000}s`);
});

server.on('error', (err: Error) => {
  logger.error('SMPP server error', { error: err.message });
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  logger.info('Shutting down SMPP test server...');
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
});
