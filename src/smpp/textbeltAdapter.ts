/**
 * TextBelt SMS Adapter
 * Sends SMS via Textbelt.com API - REAL SMS delivery!
 * FREE: 1 SMS/day with key "textbelt"
 * PAID: $3 for 50 SMS ($0.06 each)
 */

import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';

const logger = getLogger('TextBeltAdapter');

export interface ConnectionResult {
  success: boolean;
  sessionId?: string;
  errorMessage?: string;
}

export interface SubmitResult {
  success: boolean;
  carrierMessageId?: string;
  errorCode?: number;
  errorMessage?: string;
}

export enum TextBeltStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  BOUND = 'bound',
  ERROR = 'error',
}

export class TextBeltAdapter extends EventEmitter {
  private status: TextBeltStatus = TextBeltStatus.DISCONNECTED;
  private apiKey: string;
  private apiUrl: string = 'https://textbelt.com/text';

  constructor() {
    super();
    // Use "textbelt" for 1 free SMS per day, or your paid API key
    this.apiKey = process.env.TEXTBELT_API_KEY || 'textbelt';
  }

  /**
   * Connect (just validate we're ready)
   */
  async connect(): Promise<ConnectionResult> {
    try {
      this.status = TextBeltStatus.CONNECTING;
      logger.info('Initializing TextBelt SMS adapter (textbelt.com API)');

      // Validate API key is set
      if (!this.apiKey) {
        throw new Error('TEXTBELT_API_KEY not configured');
      }

      this.status = TextBeltStatus.BOUND;
      logger.info('TextBelt adapter connected successfully', {
        apiKey: this.apiKey === 'textbelt' ? 'FREE (1/day)' : 'PAID',
      });
      this.emit('connected');

      return {
        success: true,
        sessionId: 'textbelt-session',
      };
    } catch (error: any) {
      this.status = TextBeltStatus.ERROR;
      logger.error('Failed to connect TextBelt adapter', { error: error.message });
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Send SMS via Textbelt.com API
   */
  async sendMessage(
    from: string,
    to: string,
    message: string
  ): Promise<SubmitResult> {
    if (this.status !== TextBeltStatus.BOUND) {
      return {
        success: false,
        errorMessage: 'TextBelt adapter not connected',
      };
    }

    try {
      logger.info('Sending SMS via Textbelt.com', {
        to,
        messageLength: message.length,
      });

      // Make HTTP POST request to Textbelt API.
      // AbortSignal.timeout ensures a hung API can never stall the transmission loop.
      const response = await fetch(this.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          phone: to,
          message: message,
          key: this.apiKey,
        }),
        signal: AbortSignal.timeout(10_000), // 10-second hard deadline
      });

      const result: any = await response.json();

      if (result.success) {
        logger.info('SMS sent successfully via Textbelt', {
          to,
          textId: result.textId,
          quotaRemaining: result.quotaRemaining,
        });

        return {
          success: true,
          carrierMessageId: result.textId?.toString(),
        };
      } else {
        logger.error('Textbelt API error', {
          error: result.error,
          quotaRemaining: result.quotaRemaining,
        });

        return {
          success: false,
          errorMessage: result.error || 'Unknown Textbelt error',
        };
      }
    } catch (error: any) {
      logger.error('Failed to send SMS via Textbelt', { error: error.message });
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    this.status = TextBeltStatus.DISCONNECTED;
    logger.info('TextBelt adapter disconnected');
  }

  /**
   * Get current status
   */
  getStatus(): TextBeltStatus {
    return this.status;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.status === TextBeltStatus.BOUND;
  }
}
