/**
 * CLI tool for testing and managing SMS Provider
 */

import { config } from './config';
import { MessageStore } from './storage/messageStore';
import { MessageQueue } from './queue/messageQueue';
import { MessageSubmissionAPI } from './processing/submissionApi';

async function main() {
  const command = process.argv[2];

  if (!command) {
    console.log('SMS Provider CLI');
    console.log('');
    console.log('Commands:');
    console.log('  send <from> <to> <message>  - Send a test message');
    console.log('  status                       - Check system status');
    console.log('  messages [status]            - List messages');
    console.log('');
    process.exit(0);
  }

  // Initialize components
  const messageStore = new MessageStore(config.databaseUrl);
  const messageQueue = new MessageQueue();
  const submissionApi = new MessageSubmissionAPI(messageStore, messageQueue);

  try {
    switch (command) {
      case 'send':
        await handleSend(submissionApi, process.argv.slice(3));
        break;

      case 'status':
        await handleStatus(messageStore, messageQueue);
        break;

      case 'messages':
        await handleMessages(messageStore, process.argv[3]);
        break;

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } finally {
    await messageStore.close();
  }
}

async function handleSend(api: MessageSubmissionAPI, args: string[]) {
  if (args.length < 3) {
    console.error('Usage: send <from> <to> <message>');
    process.exit(1);
  }

  const [from, to, ...messageParts] = args;
  const message = messageParts.join(' ');

  console.log('Submitting message...');
  console.log(`From: ${from}`);
  console.log(`To: ${to}`);
  console.log(`Message: ${message}`);
  console.log('');

  const result = await api.submitMessage(from, to, message);

  if (result.success) {
    console.log('Message submitted successfully');
    console.log(`Message ID: ${result.messageId}`);
  } else {
    console.error('Message submission failed');
    console.error(`Error: ${result.errorMessage}`);
    if (result.validationErrors) {
      console.error('Validation errors:');
      result.validationErrors.forEach((err) => console.error(`  - ${err}`));
    }
    throw new Error('submission failed');
  }
}

async function handleStatus(store: MessageStore, queue: MessageQueue) {
  console.log('System Status');
  console.log('=============');
  console.log('');

  // Database health
  const dbHealthy = await store.healthCheck();
  console.log(`Database: ${dbHealthy ? 'healthy' : 'UNHEALTHY'}`);

  // The CLI creates its own in-process queue — it has no connection to the
  // running service's queue, so these numbers reflect only this CLI session.
  console.log(`Queue (this process only): ${queue.size()} items, healthy: ${queue.isHealthy()}`);
  console.log('');

  // Message statistics — COUNT(*) per status, no rows transferred
  const statuses: Array<import('./storage/models').MessageStatus> = [
    'queued' as any, 'sent' as any, 'delivered' as any, 'failed' as any,
  ];
  console.log('Message counts (from database):');
  for (const status of statuses) {
    const count = await store.countByStatus(status);
    console.log(`  ${status}: ${count}`);
  }
}

async function handleMessages(store: MessageStore, status?: string) {
  const messages = status
    ? await store.getMessagesByStatus(status as any, 20)
    : await store.queryMessages({}, 20);

  console.log(`Messages (showing ${messages.length}):`);
  console.log('');

  if (messages.length === 0) {
    console.log('No messages found');
    return;
  }

  messages.forEach((msg) => {
    console.log(`ID: ${msg.id}`);
    console.log(`  Direction: ${msg.direction}`);
    console.log(`  From: ${msg.from_number}`);
    console.log(`  To: ${msg.to_number}`);
    console.log(`  Status: ${msg.status}`);
    console.log(`  Content: ${msg.content.substring(0, 50)}${msg.content.length > 50 ? '...' : ''}`);
    console.log(`  Created: ${msg.created_at}`);
    if (msg.sent_at) console.log(`  Sent: ${msg.sent_at}`);
    if (msg.delivered_at) console.log(`  Delivered: ${msg.delivered_at}`);
    if (msg.error_message) console.log(`  Error: ${msg.error_message}`);
    console.log('');
  });
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
