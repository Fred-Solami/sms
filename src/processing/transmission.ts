/**
 * Message Transmission Loop
 * Processes messages from queue and sends via SMS client (SMPP or TextBelt)
 */

import { SMSClient } from '../smpp/smsClientFactory';
import { MessageQueue } from '../queue/messageQueue';
import { MessageStore } from '../storage/messageStore';
import { MessageStatus } from '../storage/models';
import { calculateBackoff } from '../utils/validation';
import { getLogger } from '../utils/logger';
import { config } from '../config';

const logger = getLogger('Transmission');

/**
 * Maximum messages to process per tick.  Prevents a single tick from
 * monopolising the event loop when the queue is deep.
 */
const BATCH_SIZE = 10;

/**
 * How often (ms) to re-run the database health check.
 * Running it on every message would flood the DB with SELECT 1 queries.
 */
const DB_HEALTH_CHECK_INTERVAL_MS = 30_000;

export class MessageTransmissionLoop {
  private running: boolean = false;
  private processingInterval: NodeJS.Timeout | null = null;

  /** Cached DB health — updated periodically, not per message. */
  private dbHealthy: boolean = true;
  private lastDbCheckAt: number = 0;

  constructor(
    private smsClient: SMSClient,
    private messageQueue: MessageQueue,
    private messageStore: MessageStore
  ) {}

  /**
   * Start the transmission loop
   */
  start(): void {
    if (this.running) {
      logger.warn('Transmission loop already running');
      return;
    }

    this.running = true;
    logger.info('Starting message transmission loop');

    // Process a batch of messages every 100ms
    this.processingInterval = setInterval(() => {
      this.processBatch().catch((error) => {
        logger.error('Error in transmission loop', { error: error.message });
      });
    }, 100);
  }

  /**
   * Stop the transmission loop
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }

    logger.info('Message transmission loop stopped');
  }

  /**
   * Refresh the cached DB health state at most once per DB_HEALTH_CHECK_INTERVAL_MS.
   * Avoids issuing a SELECT 1 for every message processed.
   */
  private async refreshDbHealth(): Promise<void> {
    const now = Date.now();
    if (now - this.lastDbCheckAt < DB_HEALTH_CHECK_INTERVAL_MS) {
      return; // still fresh
    }
    this.lastDbCheckAt = now;
    this.dbHealthy = await this.messageStore.healthCheck();
    if (!this.dbHealthy) {
      logger.error('Database health check failed — pausing transmission');
    }
  }

  /**
   * Process up to BATCH_SIZE ready messages per tick.
   * Batching reduces setInterval overhead and increases throughput.
   */
  private async processBatch(): Promise<void> {
    if (!this.smsClient.isConnected()) {
      return;
    }

    if (!this.messageQueue.isHealthy()) {
      logger.warn('Message queue is unhealthy');
      return;
    }

    await this.refreshDbHealth();
    if (!this.dbHealthy) {
      return;
    }

    for (let i = 0; i < BATCH_SIZE; i++) {
      const message = this.messageQueue.dequeue();
      if (!message) {
        break; // queue empty — no point continuing the batch
      }

      logger.debug('Processing message', {
        messageId: message.id,
        from: message.from_number,
        to: message.to_number,
      });

      try {
        const result = await this.smsClient.sendMessage(
          message.from_number,
          message.to_number,
          message.content
        );

        if (result.success) {
          await this.messageStore.updateMessageStatus(message.id, {
            status: MessageStatus.SENT,
            smpp_message_id: result.carrierMessageId,
          });

          logger.info('Message sent successfully', {
            messageId: message.id,
            carrierMessageId: result.carrierMessageId,
          });
        } else {
          await this.handleMessageFailure(message, result.errorCode, result.errorMessage);
        }
      } catch (error: any) {
        logger.error('Unexpected error processing message', {
          messageId: message.id,
          error: error.message,
        });
        await this.handleMessageFailure(message, undefined, error.message);
      }
    }
  }

  /**
   * Handle message transmission failure
   */
  private async handleMessageFailure(
    message: any,
    errorCode?: number,
    errorMessage?: string
  ): Promise<void> {
    // Increment retry count
    const retryCount = await this.messageStore.incrementRetryCount(message.id);

    logger.warn('Message transmission failed', {
      messageId: message.id,
      retryCount,
      errorCode,
      errorMessage,
    });

    if (retryCount < config.maxRetries) {
      // Requeue with exponential backoff
      const delay = calculateBackoff(retryCount, config.baseDelay, config.maxDelay);
      
      // Update message in database
      message.retry_count = retryCount;
      
      this.messageQueue.requeueWithDelay(message, delay);
      
      logger.info('Message requeued for retry', {
        messageId: message.id,
        retryCount,
        delaySeconds: delay,
      });
    } else {
      // Max retries reached - mark as permanently failed
      await this.messageStore.updateMessageStatus(message.id, {
        status: MessageStatus.FAILED,
        error_code: errorCode,
        error_message: errorMessage || 'Max retries exceeded',
      });

      logger.error('Message permanently failed', {
        messageId: message.id,
        retryCount,
      });
    }
  }

  /**
   * Check if transmission loop is running
   */
  isRunning(): boolean {
    return this.running;
  }
}
