/**
 * Message Store - Database persistence for messages and delivery receipts
 */

import { Pool, PoolClient } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import {
  Message,
  MessageStatus,
  CreateMessageParams,
  UpdateMessageStatusParams,
  MessageFilters,
  DeliveryReceipt,
} from './models';
import { getLogger } from '../utils/logger';

const logger = getLogger('MessageStore');

export class MessageStore {
  private pool: Pool;

  constructor(connectionString: string, poolSize: number = 10, maxOverflow: number = 20) {
    this.pool = new Pool({
      connectionString,
      max: poolSize + maxOverflow,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });

    // Log pool errors
    this.pool.on('error', (err) => {
      logger.error('Unexpected database pool error', { error: err });
    });
  }

  /**
   * Create a new message record
   */
  async createMessage(params: CreateMessageParams): Promise<string> {
    const id = uuidv4();
    const status = params.status || MessageStatus.QUEUED;
    const now = new Date();

    const query = `
      INSERT INTO messages (
        id, direction, from_number, to_number, content, status, created_at, queued_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id
    `;

    const values = [
      id,
      params.direction,
      params.from_number,
      params.to_number,
      params.content,
      status,
      now,
      status === MessageStatus.QUEUED ? now : null,
    ];

    try {
      const result = await this.pool.query(query, values);
      logger.info('Message created', {
        id,
        direction: params.direction,
        from: params.from_number,
        to: params.to_number,
      });
      return result.rows[0].id;
    } catch (error) {
      logger.error('Failed to create message', { error, params });
      throw error;
    }
  }

  /**
   * Update message status
   */
  async updateMessageStatus(
    messageId: string,
    params: UpdateMessageStatusParams
  ): Promise<boolean> {
    const updates: string[] = ['status = $2'];
    const values: any[] = [messageId, params.status];
    let paramIndex = 3;

    // Build dynamic update query based on provided parameters
    if (params.smpp_message_id !== undefined) {
      updates.push(`smpp_message_id = $${paramIndex++}`);
      values.push(params.smpp_message_id);
    }

    if (params.carrier_receipt !== undefined) {
      updates.push(`carrier_receipt = $${paramIndex++}`);
      values.push(params.carrier_receipt);
    }

    if (params.error_code !== undefined) {
      updates.push(`error_code = $${paramIndex++}`);
      values.push(params.error_code);
    }

    if (params.error_message !== undefined) {
      updates.push(`error_message = $${paramIndex++}`);
      values.push(params.error_message);
    }

    // Set timestamp based on status
    const now = new Date();
    switch (params.status) {
      case MessageStatus.SENT:
        updates.push(`sent_at = $${paramIndex++}`);
        values.push(now);
        break;
      case MessageStatus.DELIVERED:
        updates.push(`delivered_at = $${paramIndex++}`);
        values.push(now);
        break;
      case MessageStatus.FAILED:
      case MessageStatus.REJECTED:
      case MessageStatus.EXPIRED:
        updates.push(`failed_at = $${paramIndex++}`);
        values.push(now);
        break;
    }

    const query = `
      UPDATE messages 
      SET ${updates.join(', ')}
      WHERE id = $1
      RETURNING id
    `;

    try {
      const result = await this.pool.query(query, values);
      if (result.rowCount === 0) {
        logger.warn('Message not found for status update', { messageId });
        return false;
      }
      logger.info('Message status updated', { messageId, status: params.status });
      return true;
    } catch (error) {
      logger.error('Failed to update message status', { error, messageId, params });
      throw error;
    }
  }

  /**
   * Get message by ID
   */
  async getMessageById(messageId: string): Promise<Message | null> {
    const query = 'SELECT * FROM messages WHERE id = $1';

    try {
      const result = await this.pool.query(query, [messageId]);
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Failed to get message by ID', { error, messageId });
      throw error;
    }
  }

  /**
   * Get messages by status
   */
  async getMessagesByStatus(status: MessageStatus, limit: number = 100): Promise<Message[]> {
    const query = `
      SELECT * FROM messages 
      WHERE status = $1 
      ORDER BY created_at ASC 
      LIMIT $2
    `;

    try {
      const result = await this.pool.query(query, [status, limit]);
      return result.rows;
    } catch (error) {
      logger.error('Failed to get messages by status', { error, status });
      throw error;
    }
  }

  /**
   * Query messages with filters
   */
  async queryMessages(filters: MessageFilters, limit: number = 100): Promise<Message[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    }

    if (filters.direction) {
      conditions.push(`direction = $${paramIndex++}`);
      values.push(filters.direction);
    }

    if (filters.from_number) {
      conditions.push(`from_number = $${paramIndex++}`);
      values.push(filters.from_number);
    }

    if (filters.to_number) {
      conditions.push(`to_number = $${paramIndex++}`);
      values.push(filters.to_number);
    }

    if (filters.created_after) {
      conditions.push(`created_at >= $${paramIndex++}`);
      values.push(filters.created_after);
    }

    if (filters.created_before) {
      conditions.push(`created_at <= $${paramIndex++}`);
      values.push(filters.created_before);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const query = `
      SELECT * FROM messages 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${paramIndex}
    `;
    values.push(limit);

    try {
      const result = await this.pool.query(query, values);
      return result.rows;
    } catch (error) {
      logger.error('Failed to query messages', { error, filters });
      throw error;
    }
  }

  /**
   * Find message by carrier message ID
   */
  async findMessageByCarrierID(carrierMessageId: string): Promise<Message | null> {
    const query = 'SELECT * FROM messages WHERE smpp_message_id = $1';

    try {
      const result = await this.pool.query(query, [carrierMessageId]);
      return result.rows.length > 0 ? result.rows[0] : null;
    } catch (error) {
      logger.error('Failed to find message by carrier ID', { error, carrierMessageId });
      throw error;
    }
  }

  /**
   * Record delivery receipt
   */
  async recordDeliveryReceipt(receipt: Omit<DeliveryReceipt, 'id' | 'received_at'>): Promise<string> {
    const id = uuidv4();
    const now = new Date();

    const query = `
      INSERT INTO delivery_receipts (
        id, message_id, carrier_message_id, delivery_status, 
        error_code, submit_date, done_date, text, received_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `;

    const values = [
      id,
      receipt.message_id,
      receipt.carrier_message_id,
      receipt.delivery_status,
      receipt.error_code,
      receipt.submit_date,
      receipt.done_date,
      receipt.text,
      now,
    ];

    try {
      const result = await this.pool.query(query, values);
      logger.info('Delivery receipt recorded', {
        id,
        messageId: receipt.message_id,
        status: receipt.delivery_status,
      });
      return result.rows[0].id;
    } catch (error) {
      logger.error('Failed to record delivery receipt', { error, receipt });
      throw error;
    }
  }

  /**
   * Increment retry count for a message
   */
  async incrementRetryCount(messageId: string): Promise<number> {
    const query = `
      UPDATE messages 
      SET retry_count = retry_count + 1 
      WHERE id = $1 
      RETURNING retry_count
    `;

    try {
      const result = await this.pool.query(query, [messageId]);
      if (result.rowCount === 0) {
        throw new Error(`Message not found: ${messageId}`);
      }
      return result.rows[0].retry_count;
    } catch (error) {
      logger.error('Failed to increment retry count', { error, messageId });
      throw error;
    }
  }

  /**
   * Close database connection pool
   */
  async close(): Promise<void> {
    await this.pool.end();
    logger.info('Database connection pool closed');
  }

  /**
   * Health check - verify database connectivity
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.pool.query('SELECT 1');
      return true;
    } catch (error) {
      logger.error('Database health check failed', { error });
      return false;
    }
  }
}
