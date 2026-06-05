/**
 * Delivery Tracker
 * Processes delivery receipts from carrier
 */

import { MessageStore } from '../storage/messageStore';
import { MessageStatus } from '../storage/models';
import { getLogger } from '../utils/logger';

const logger = getLogger('DeliveryTracker');

export class DeliveryTracker {
  constructor(private messageStore: MessageStore) {}

  /**
   * Process delivery receipt PDU from SMPP
   */
  async processReceipt(pdu: any): Promise<boolean> {
    try {
      // Extract receipt fields from short_message
      const receiptText = pdu.short_message?.message || '';
      
      logger.debug('Processing delivery receipt', { receiptText, pdu });

      // Parse receipt fields (format: "id:MSGID sub:001 dlvrd:001 ...")
      const fields = this.parseReceiptText(receiptText);
      
      if (!fields.id) {
        logger.warn('Delivery receipt missing message ID', { receiptText });
        return false;
      }

      // Find original message by carrier ID
      const message = await this.messageStore.findMessageByCarrierID(fields.id);
      
      if (!message) {
        logger.warn('Received receipt for unknown message', {
          carrierMessageId: fields.id,
        });
        return false;
      }

      // Map carrier status to internal status
      const newStatus = this.mapCarrierStatus(fields.stat || '');

      // Update message status
      await this.messageStore.updateMessageStatus(message.id, {
        status: newStatus,
        carrier_receipt: receiptText,
        error_code: fields.err ? parseInt(fields.err) : undefined,
      });

      // Record delivery receipt
      await this.messageStore.recordDeliveryReceipt({
        message_id: message.id,
        carrier_message_id: fields.id,
        delivery_status: fields.stat || 'UNKNOWN',
        error_code: fields.err ? parseInt(fields.err) : null,
        submit_date: fields.submit_date ? new Date(fields.submit_date) : null,
        done_date: fields.done_date ? new Date(fields.done_date) : null,
        text: receiptText,
      });

      logger.info('Delivery receipt processed', {
        messageId: message.id,
        carrierMessageId: fields.id,
        status: newStatus,
      });

      return true;
    } catch (error: any) {
      logger.error('Error processing delivery receipt', {
        error: error.message,
        pdu,
      });
      return false;
    }
  }

  /**
   * Parse delivery receipt text
   */
  private parseReceiptText(text: string): Record<string, string> {
    const fields: Record<string, string> = {};
    
    // Common receipt format: "id:MSGID sub:001 dlvrd:001 submit date:... done date:... stat:DELIVRD err:000"
    const patterns = [
      /id:([^\s]+)/,
      /sub:([^\s]+)/,
      /dlvrd:([^\s]+)/,
      /submit date:(\d+)/,
      /done date:(\d+)/,
      /stat:([^\s]+)/,
      /err:([^\s]+)/,
    ];

    const keys = ['id', 'sub', 'dlvrd', 'submit_date', 'done_date', 'stat', 'err'];

    patterns.forEach((pattern, index) => {
      const match = text.match(pattern);
      if (match) {
        fields[keys[index]] = match[1];
      }
    });

    return fields;
  }

  /**
   * Map carrier delivery status to internal message status
   */
  private mapCarrierStatus(carrierStatus: string): MessageStatus {
    const statusMap: Record<string, MessageStatus> = {
      DELIVRD: MessageStatus.DELIVERED,
      EXPIRED: MessageStatus.FAILED,
      DELETED: MessageStatus.FAILED,
      UNDELIV: MessageStatus.FAILED,
      ACCEPTD: MessageStatus.SENT,
      UNKNOWN: MessageStatus.FAILED,
      REJECTD: MessageStatus.REJECTED,
    };

    return statusMap[carrierStatus] || MessageStatus.FAILED;
  }
}
