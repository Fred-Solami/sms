/**
 * Message Submission API
 * Accepts message submission requests and validates input
 */

import { MessageStore } from '../storage/messageStore';
import { MessageQueue } from '../queue/messageQueue';
import { Message, MessageDirection, MessageStatus } from '../storage/models';
import { validatePhoneNumber, validateMessageContent } from '../utils/validation';
import { getLogger } from '../utils/logger';

const logger = getLogger('SubmissionAPI');

export interface SubmissionResult {
  success: boolean;
  messageId?: string;
  errorMessage?: string;
  validationErrors?: string[];
}

export class MessageSubmissionAPI {
  constructor(
    private messageStore: MessageStore,
    private messageQueue: MessageQueue
  ) {}

  /**
   * Submit a message for sending
   */
  async submitMessage(
    from: string,
    to: string,
    content: string
  ): Promise<SubmissionResult> {
    // Validate phone numbers
    const validationErrors: string[] = [];

    if (!validatePhoneNumber(from)) {
      validationErrors.push(`Invalid from number: ${from}`);
    }

    if (!validatePhoneNumber(to)) {
      validationErrors.push(`Invalid to number: ${to}`);
    }

    // Validate message content
    const contentValidation = validateMessageContent(content, 'GSM7');
    if (!contentValidation.valid) {
      validationErrors.push(contentValidation.error);
    }

    if (validationErrors.length > 0) {
      logger.warn('Message validation failed', { validationErrors, from, to });
      return {
        success: false,
        errorMessage: 'Validation failed',
        validationErrors,
      };
    }

    try {
      // Create message record in database
      const now = new Date();
      const messageId = await this.messageStore.createMessage({
        direction: MessageDirection.OUTBOUND,
        from_number: from,
        to_number: to,
        content,
        status: MessageStatus.QUEUED,
      });

      // Construct the Message object from known fields — avoids a second DB round-trip.
      const message: Message = {
        id: messageId,
        direction: MessageDirection.OUTBOUND,
        from_number: from,
        to_number: to,
        content,
        status: MessageStatus.QUEUED,
        smpp_message_id: null,
        carrier_receipt: null,
        retry_count: 0,
        error_code: null,
        error_message: null,
        created_at: now,
        queued_at: now,
        sent_at: null,
        delivered_at: null,
        failed_at: null,
      };

      // Enqueue for transmission
      const enqueued = this.messageQueue.enqueue(message);
      if (!enqueued) {
        // Queue is full - update message status
        await this.messageStore.updateMessageStatus(messageId, {
          status: MessageStatus.FAILED,
          error_message: 'Queue overflow',
        });

        return {
          success: false,
          errorMessage: 'Message queue is full, please try again later',
        };
      }

      logger.info('Message submitted successfully', {
        messageId,
        from,
        to,
        queueSize: this.messageQueue.size(),
      });

      return {
        success: true,
        messageId,
      };
    } catch (error: any) {
      logger.error('Failed to submit message', { error: error.message, from, to });
      return {
        success: false,
        errorMessage: `Internal error: ${error.message}`,
      };
    }
  }
}
