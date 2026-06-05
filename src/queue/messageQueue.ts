/**
 * Message Queue
 * In-memory FIFO queue for buffering outbound messages.
 *
 * Scalability design:
 *   - readyQueue  : array with a head-pointer, giving O(1) amortised enqueue/dequeue
 *                   without the O(n) element-shifting that Array.splice / Array.shift cause.
 *   - delayedQueue: array kept sorted by retryAfter (binary insert O(log n)).
 *                   Items are promoted to readyQueue the moment their delay expires,
 *                   so dequeue never scans the whole list.
 */

import { EventEmitter } from 'events';
import { Message } from '../storage/models';
import { getLogger } from '../utils/logger';
import { config } from '../config';

const logger = getLogger('MessageQueue');

/** Compact the backing array when the wasted head region exceeds this many slots. */
const COMPACT_THRESHOLD = 1000;

interface QueuedMessage {
  message: Message;
  enqueuedAt: Date;
  retryAfter?: Date;
}

export class MessageQueue extends EventEmitter {
  /** Ready messages — consumed from readyHead, appended at the tail. */
  private readyQueue: QueuedMessage[] = [];
  private readyHead: number = 0;

  /** Delayed messages — sorted ascending by retryAfter. */
  private delayedQueue: QueuedMessage[] = [];

  private maxSize: number;

  constructor(maxSize: number = config.queueMaxSize) {
    super();
    this.maxSize = maxSize;
  }

  // ─── private helpers ───────────────────────────────────────────────────────

  private get totalSize(): number {
    return (this.readyQueue.length - this.readyHead) + this.delayedQueue.length;
  }

  /**
   * Promote any delayed messages whose retryAfter has now passed into the
   * ready queue.  O(k) where k is the number of items becoming ready — typically
   * very small and bounded.
   */
  private promoteReady(): void {
    const now = Date.now();
    while (
      this.delayedQueue.length > 0 &&
      (this.delayedQueue[0].retryAfter as Date).getTime() <= now
    ) {
      // delayedQueue is sorted, so the first item is always the nearest expiry.
      this.readyQueue.push(this.delayedQueue.shift()!);
    }
  }

  /**
   * Compact the readyQueue backing array when the dead head region has grown
   * large enough to matter.  Amortised O(1) over many dequeues.
   */
  private compactIfNeeded(): void {
    if (
      this.readyHead > COMPACT_THRESHOLD &&
      this.readyHead > this.readyQueue.length / 2
    ) {
      this.readyQueue = this.readyQueue.slice(this.readyHead);
      this.readyHead = 0;
    }
  }

  // ─── public API ────────────────────────────────────────────────────────────

  /**
   * Enqueue a message — O(1)
   */
  enqueue(message: Message): boolean {
    if (this.totalSize >= this.maxSize) {
      logger.error('Queue is full', { size: this.totalSize, maxSize: this.maxSize });
      this.emit('overflow');
      return false;
    }

    this.readyQueue.push({ message, enqueuedAt: new Date() });

    logger.debug('Message enqueued', { messageId: message.id, queueSize: this.totalSize });
    this.emit('enqueued', message);
    return true;
  }

  /**
   * Dequeue the next ready message — O(1) amortised
   * (no linear scan, no element shifting)
   */
  dequeue(): Message | null {
    this.promoteReady();

    if (this.readyHead >= this.readyQueue.length) {
      return null;
    }

    const item = this.readyQueue[this.readyHead++];
    this.compactIfNeeded();

    logger.debug('Message dequeued', { messageId: item.message.id, queueSize: this.totalSize });
    this.emit('dequeued', item.message);
    return item.message;
  }

  /**
   * Peek at the next ready message without removing it — O(1) amortised
   */
  peek(): Message | null {
    this.promoteReady();

    if (this.readyHead >= this.readyQueue.length) {
      return null;
    }

    return this.readyQueue[this.readyHead].message;
  }

  /**
   * Requeue a message after a delay (retry backoff).
   * Uses binary search to insert into the sorted delayedQueue — O(log n).
   */
  requeueWithDelay(message: Message, delaySeconds: number): boolean {
    if (this.totalSize >= this.maxSize) {
      logger.error('Cannot requeue — queue is full', { messageId: message.id });
      return false;
    }

    const retryAfter = new Date(Date.now() + delaySeconds * 1000);
    const item: QueuedMessage = { message, enqueuedAt: new Date(), retryAfter };

    // Binary-insert to maintain ascending sort by retryAfter.
    const retryMs = retryAfter.getTime();
    let lo = 0;
    let hi = this.delayedQueue.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if ((this.delayedQueue[mid].retryAfter as Date).getTime() <= retryMs) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    this.delayedQueue.splice(lo, 0, item);

    logger.info('Message requeued with delay', {
      messageId: message.id,
      delaySeconds,
      retryAfter,
    });
    return true;
  }

  /**
   * Total number of messages in the queue (ready + delayed)
   */
  size(): number {
    return this.totalSize;
  }

  /**
   * Number of messages that are immediately ready to send
   */
  readyCount(): number {
    this.promoteReady();
    return this.readyQueue.length - this.readyHead;
  }

  /**
   * Clear all messages from queue
   */
  clear(): void {
    const count = this.totalSize;
    this.readyQueue = [];
    this.readyHead = 0;
    this.delayedQueue = [];
    logger.info('Queue cleared', { clearedCount: count });
  }

  /**
   * Get all messages (ready + delayed) — for inspection/debugging
   */
  getAll(): Message[] {
    this.promoteReady();
    const ready = this.readyQueue.slice(this.readyHead).map((i) => i.message);
    const delayed = this.delayedQueue.map((i) => i.message);
    return [...ready, ...delayed];
  }

  /**
   * Returns false when the queue is at capacity
   */
  isHealthy(): boolean {
    return this.totalSize < this.maxSize;
  }
}
