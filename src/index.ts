/**
 * Main entry point for SMS Provider service
 */

import { config } from './config';
import { logger } from './utils/logger';
import { MessageStore } from './storage/messageStore';
import { createSMSClient, SMSClient } from './smpp/smsClientFactory';
import { MessageQueue } from './queue/messageQueue';
import { MessageSubmissionAPI } from './processing/submissionApi';
import { MessageTransmissionLoop } from './processing/transmission';
import { DeliveryTracker } from './processing/deliveryTracker';
import { InboundHandler } from './inbound/handler';
import { MessageStatus } from './storage/models';

// Global components
let messageStore: MessageStore;
let smsClient: SMSClient;
let messageQueue: MessageQueue;
let submissionApi: MessageSubmissionAPI;
let transmissionLoop: MessageTransmissionLoop;
let deliveryTracker: DeliveryTracker;
let inboundHandler: InboundHandler;

// Global flag for graceful shutdown
let running = true;

// Signal handlers for graceful shutdown
process.on('SIGINT', () => {
  logger.info('Received SIGINT, initiating graceful shutdown...');
  running = false;
});

process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, initiating graceful shutdown...');
  running = false;
});

async function main() {
  logger.info('Starting SMS Service Provider...');
  logger.info('Version: 0.1.0');

  // Validate configuration
  try {
    config.validate();
    logger.info('Configuration validated successfully');
  } catch (error) {
    logger.error('Configuration validation failed', { error });
    process.exit(1);
  }

  // Hide credentials in logs
  const dbUrlParts = config.databaseUrl.split('@');
  const dbLocation = dbUrlParts.length > 1 ? dbUrlParts[1] : config.databaseUrl;
  logger.info(`Database: ${dbLocation}`);

  try {
    // Initialize database connection
    logger.info('Initializing database connection...');
    messageStore = new MessageStore(
      config.databaseUrl,
      config.dbPoolSize,
      config.dbMaxOverflow
    );

    // Verify database connectivity
    const dbHealthy = await messageStore.healthCheck();
    if (!dbHealthy) {
      throw new Error('Database health check failed');
    }
    logger.info('Database connection established');

    // Initialize message queue
    logger.info('Initializing message queue...');
    messageQueue = new MessageQueue(config.queueMaxSize);
    
    // Load pending messages from database into queue
    logger.info('Loading pending messages from database...');
    const pendingMessages = await messageStore.getMessagesByStatus(MessageStatus.QUEUED, 1000);
    for (const message of pendingMessages) {
      messageQueue.enqueue(message);
    }
    logger.info(`Loaded ${pendingMessages.length} pending messages into queue`);
    logger.info('Message queue initialized');

    // Initialize SMS client (SMPP or TextBelt)
    logger.info(`Initializing SMS client (mode: ${config.smsProvider})...`);
    smsClient = createSMSClient();

    // Initialize submission API
    submissionApi = new MessageSubmissionAPI(messageStore, messageQueue);
    logger.info('Message submission API initialized');

    // Initialize delivery tracker
    deliveryTracker = new DeliveryTracker(messageStore);
    logger.info('Delivery tracker initialized');

    // Initialize inbound handler
    inboundHandler = new InboundHandler(messageStore);
    logger.info('Inbound handler initialized');

    // Initialize transmission loop (before connecting SMS client)
    transmissionLoop = new MessageTransmissionLoop(
      smsClient,
      messageQueue,
      messageStore
    );
    logger.info('Message transmission loop initialized');

    // Setup SMS client event handlers
    smsClient.on('connected', () => {
      logger.info('SMS client connected and ready');
      // Start transmission loop when connected
      if (!transmissionLoop.isRunning()) {
        transmissionLoop.start();
      }
    });

    smsClient.on('disconnected', () => {
      logger.warn('SMS client disconnected');
      // Stop transmission loop when disconnected
      if (transmissionLoop.isRunning()) {
        transmissionLoop.stop();
      }
    });

    smsClient.on('delivery_receipt', async (pdu: any) => {
      await deliveryTracker.processReceipt(pdu);
    });

    smsClient.on('inbound_message', async (pdu: any) => {
      await inboundHandler.processInboundMessage(pdu);
    });

    smsClient.on('max_reconnect_attempts', () => {
      logger.error('Max SMS reconnection attempts reached - shutting down');
      running = false;
    });

    // Connect to SMS gateway
    const connectResult = await smsClient.connect();
    if (!connectResult.success) {
      throw new Error(`SMS connection failed: ${connectResult.errorMessage}`);
    }

    logger.info('SMS Service Provider started successfully');
    logger.info('Press Ctrl+C to stop');
    logger.info(`Queue size: ${messageQueue.size()}`);
    logger.info(`SMS client status: ${smsClient.getStatus()}`);

    // Periodic health log every 60 seconds — using setInterval avoids the
    // unreliable Date.now() % 60000 pattern that can fire 0 or 2+ times per minute.
    const healthInterval = setInterval(async () => {
      if (!running) return;
      logger.debug('Health check', {
        queueSize: messageQueue.size(),
        smsStatus: smsClient.getStatus(),
        dbHealthy: await messageStore.healthCheck(),
      });
    }, 60_000);

    // Main loop - keep application running
    while (running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    clearInterval(healthInterval);
  } catch (error: any) {
    logger.error('Fatal error during startup', { error: error.message });
    throw error;
  } finally {
    logger.info('Shutting down SMS Service Provider...');

    // Cleanup
    if (transmissionLoop) {
      transmissionLoop.stop();
      logger.info('Transmission loop stopped');
    }

    if (smsClient) {
      await smsClient.disconnect();
      logger.info('SMS client disconnected');
    }

    if (messageStore) {
      await messageStore.close();
      logger.info('Database connection closed');
    }

    logger.info('Shutdown complete');
  }
}

// Start the application
main().catch((error) => {
  logger.error('Fatal error', { error });
  process.exit(1);
});
