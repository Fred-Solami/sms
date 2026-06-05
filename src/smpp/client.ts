/**
 * SMPP Client Manager
 * Manages SMPP protocol connection to carrier gateway
 */

import * as smpp from 'smpp';
import { EventEmitter } from 'events';
import { getLogger } from '../utils/logger';
import { config } from '../config';
import { calculateBackoff } from '../utils/validation';

const logger = getLogger('SMPPClient');

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

export enum SMPPClientStatus {
  DISCONNECTED = 'disconnected',
  CONNECTING = 'connecting',
  CONNECTED = 'connected',
  BOUND = 'bound',
  ERROR = 'error',
}

export class SMPPClient extends EventEmitter {
  private session: any = null;
  private status: SMPPClientStatus = SMPPClientStatus.DISCONNECTED;
  private reconnectAttempts: number = 0;
  private keepaliveInterval: NodeJS.Timeout | null = null;
  private reconnectTimeout: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Connect to SMPP gateway
   */
  async connect(): Promise<ConnectionResult> {
    if (this.status === SMPPClientStatus.BOUND) {
      return { success: true, sessionId: this.session?.system_id };
    }

    try {
      this.status = SMPPClientStatus.CONNECTING;
      logger.info('Connecting to SMPP gateway', {
        host: config.smppHost,
        port: config.smppPort,
        systemId: config.smppSystemId,
      });

      return await new Promise((resolve, reject) => {
        // Create SMPP session
        this.session = smpp.connect(
          {
            url: `smpp://${config.smppHost}:${config.smppPort}`,
            auto_enquire_link_period: config.keepaliveInterval * 1000,
            debug: config.logLevel === 'debug',
          },
          () => {
            // Connection established, now bind
            this.status = SMPPClientStatus.CONNECTED;
            logger.info('TCP connection established, sending bind request');

            this.session.bind_transceiver(
              {
                system_id: config.smppSystemId,
                password: config.smppPassword,
                system_type: config.smppSystemType,
                interface_version: 1,
                addr_ton: 0,
                addr_npi: 0,
                address_range: '',
              },
              (pdu: any) => {
                if (pdu.command_status === 0) {
                  this.status = SMPPClientStatus.BOUND;
                  this.reconnectAttempts = 0;
                  logger.info('Successfully bound to SMPP gateway', {
                    systemId: pdu.system_id,
                  });

                  this.setupEventHandlers();
                  this.emit('connected');

                  resolve({
                    success: true,
                    sessionId: pdu.system_id,
                  });
                } else {
                  this.status = SMPPClientStatus.ERROR;
                  const errorMsg = `Bind failed with status: ${pdu.command_status}`;
                  logger.error(errorMsg, { commandStatus: pdu.command_status });
                  reject(new Error(errorMsg));
                }
              }
            );
          }
        );

        // Handle connection errors
        this.session.on('error', (error: Error) => {
          logger.error('SMPP connection error', { error: error.message });
          this.status = SMPPClientStatus.ERROR;
          reject(error);
        });

        // Handle close
        this.session.on('close', () => {
          logger.warn('SMPP connection closed');
          this.handleDisconnect();
        });
      });
    } catch (error: any) {
      this.status = SMPPClientStatus.ERROR;
      logger.error('Failed to connect to SMPP gateway', { error: error.message });
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Setup event handlers for SMPP session
   */
  private setupEventHandlers(): void {
    if (!this.session) return;

    // Handle delivery receipts and inbound messages
    this.session.on('deliver_sm', (pdu: any) => {
      // Check if it's a delivery receipt or inbound message
      if (pdu.esm_class & 0x04) {
        // Delivery receipt
        logger.debug('Received delivery receipt', { pdu });
        this.emit('delivery_receipt', pdu);
      } else {
        // Inbound message
        logger.debug('Received inbound message', { pdu });
        this.emit('inbound_message', pdu);
      }

      // Send acknowledgment
      this.session.deliver_sm_resp({ sequence_number: pdu.sequence_number });
    });

    // Handle unbind
    this.session.on('unbind', () => {
      logger.info('Received unbind request from gateway');
      this.session.unbind_resp();
      this.handleDisconnect();
    });
  }

  /**
   * Send SMS message
   */
  async sendMessage(
    from: string,
    to: string,
    message: string
  ): Promise<SubmitResult> {
    if (this.status !== SMPPClientStatus.BOUND) {
      return {
        success: false,
        errorMessage: 'Not connected to SMPP gateway',
      };
    }

    try {
      return await new Promise((resolve) => {
        this.session.submit_sm(
          {
            source_addr: from,
            destination_addr: to,
            short_message: message,
            registered_delivery: 1, // Request delivery receipt
          },
          (pdu: any) => {
            if (pdu.command_status === 0) {
              logger.info('Message submitted successfully', {
                messageId: pdu.message_id,
                from,
                to,
              });
              resolve({
                success: true,
                carrierMessageId: pdu.message_id,
              });
            } else {
              logger.error('Message submission failed', {
                commandStatus: pdu.command_status,
                from,
                to,
              });
              resolve({
                success: false,
                errorCode: pdu.command_status,
                errorMessage: `Submit failed with status: ${pdu.command_status}`,
              });
            }
          }
        );
      });
    } catch (error: any) {
      logger.error('Error sending message', { error: error.message });
      return {
        success: false,
        errorMessage: error.message,
      };
    }
  }

  /**
   * Disconnect from SMPP gateway
   */
  async disconnect(): Promise<void> {
    if (this.keepaliveInterval) {
      clearInterval(this.keepaliveInterval);
      this.keepaliveInterval = null;
    }

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.session) {
      try {
        await new Promise<void>((resolve) => {
          this.session.unbind(() => {
            this.session.close();
            resolve();
          });
        });
      } catch (error) {
        logger.error('Error during disconnect', { error });
        if (this.session) {
          this.session.close();
        }
      }
    }

    this.status = SMPPClientStatus.DISCONNECTED;
    this.session = null;
    logger.info('Disconnected from SMPP gateway');
  }

  /**
   * Handle disconnection and attempt reconnection
   */
  private handleDisconnect(): void {
    this.status = SMPPClientStatus.DISCONNECTED;
    this.session = null;
    this.emit('disconnected');

    if (this.reconnectAttempts < config.maxReconnectAttempts) {
      const delay = calculateBackoff(
        this.reconnectAttempts,
        config.baseDelay,
        config.maxDelay
      );
      this.reconnectAttempts++;

      logger.info('Scheduling reconnection', {
        attempt: this.reconnectAttempts,
        delaySeconds: delay,
      });

      this.reconnectTimeout = setTimeout(() => {
        this.connect().catch((error) => {
          logger.error('Reconnection failed', { error });
        });
      }, delay * 1000);
    } else {
      logger.error('Max reconnection attempts reached', {
        attempts: this.reconnectAttempts,
      });
      this.emit('max_reconnect_attempts');
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): SMPPClientStatus {
    return this.status;
  }

  /**
   * Check if connected and bound
   */
  isConnected(): boolean {
    return this.status === SMPPClientStatus.BOUND;
  }
}
