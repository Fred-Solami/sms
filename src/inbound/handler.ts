/**
 * Inbound Message Handler
 * Processes incoming SMS from end users
 */

import { MessageStore } from '../storage/messageStore';
import { MessageDirection, MessageStatus } from '../storage/models';
import { getLogger } from '../utils/logger';

const logger = getLogger('InboundHandler');

export class InboundHandler {
  constructor(private messageStore: MessageStore) {}

  /**
   * Process inbound message PDU from SMPP
   */
  async processInboundMessage(pdu: any): Promise<boolean> {
    try {
      // Extract message fields
      const fromNumber = pdu.source_addr || '';
      const toNumber = pdu.destination_addr || '';
      const content = this.decodeMessage(pdu);

      logger.debug('Processing inbound message', {
        from: fromNumber,
        to: toNumber,
        contentLength: content.length,
      });

      if (!fromNumber || !toNumber || !content) {
        logger.warn('Inbound message missing required fields', { pdu });
        return false;
      }

      // Create inbound message record
      const messageId = await this.messageStore.createMessage({
        direction: MessageDirection.INBOUND,
        from_number: fromNumber,
        to_number: toNumber,
        content,
        status: MessageStatus.DELIVERED,
      });

      logger.info('Inbound message received and stored', {
        messageId,
        from: fromNumber,
        to: toNumber,
      });

      // TODO: Route to destination (future: webhook delivery)
      // For MVP: just log and store

      return true;
    } catch (error: any) {
      logger.error('Error processing inbound message', {
        error: error.message,
        pdu,
      });
      return false;
    }
  }

  /**
   * Decode message content based on encoding
   */
  private decodeMessage(pdu: any): string {
    const dataCoding = pdu.data_coding || 0;
    const shortMessage = pdu.short_message;

    if (!shortMessage) {
      return '';
    }

    // Handle different encodings
    if (typeof shortMessage === 'string') {
      return shortMessage;
    }

    if (shortMessage.message) {
      return shortMessage.message;
    }

    // For buffer, convert to string
    if (Buffer.isBuffer(shortMessage)) {
      // GSM-7 encoding (default)
      if (dataCoding === 0) {
        return shortMessage.toString('ascii');
      }
      // UCS-2 encoding
      else if (dataCoding === 8) {
        return shortMessage.toString('utf16le');
      }
      // Default to UTF-8
      else {
        return shortMessage.toString('utf8');
      }
    }

    return String(shortMessage);
  }
}
