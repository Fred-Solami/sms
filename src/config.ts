/**
 * Configuration management for SMS Provider
 */

import * as dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config();

/**
 * Parse an integer environment variable.
 * Throws at startup rather than silently passing NaN to downstream consumers
 * (e.g. pg Pool's `max` option).
 */
function parseIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = parseInt(raw, 10);
  if (Number.isNaN(value)) {
    throw new Error(`Configuration error: ${name}="${raw}" is not a valid integer`);
  }
  return value;
}

export interface AppConfig {
  // Database
  databaseUrl: string;
  dbPoolSize: number;
  dbMaxOverflow: number;

  // SMS Provider Mode
  smsProvider: 'smpp' | 'textbelt';

  // SMPP Carrier
  smppHost: string;
  smppPort: number;
  smppSystemId: string;
  smppPassword: string;
  smppSystemType: string;

  // TextBelt (Email-to-SMS)
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpPass: string;
  smtpFrom: string;

  // Application
  nodeEnv: string;
  logLevel: string;
  maxRetries: number;
  queueMaxSize: number;
  keepaliveInterval: number;
  maxReconnectAttempts: number;

  // Backoff configuration
  baseDelay: number;
  maxDelay: number;
}

class Config implements AppConfig {
  // Database
  databaseUrl: string = process.env.DATABASE_URL || 'postgresql://localhost/sms_provider';
  dbPoolSize: number = parseIntEnv('DB_POOL_SIZE', 10);
  dbMaxOverflow: number = parseIntEnv('DB_MAX_OVERFLOW', 20);

  // SMS Provider Mode
  smsProvider: 'smpp' | 'textbelt' = (process.env.SMS_PROVIDER as 'smpp' | 'textbelt') || 'textbelt';

  // SMPP Carrier
  smppHost: string = process.env.SMPP_HOST || '';
  smppPort: number = parseIntEnv('SMPP_PORT', 2775);
  smppSystemId: string = process.env.SMPP_SYSTEM_ID || '';
  smppPassword: string = process.env.SMPP_PASSWORD || '';
  smppSystemType: string = process.env.SMPP_SYSTEM_TYPE || '';

  // TextBelt (Email-to-SMS)
  smtpHost: string = process.env.SMTP_HOST || 'smtp.gmail.com';
  smtpPort: number = parseIntEnv('SMTP_PORT', 587);
  smtpUser: string = process.env.SMTP_USER || '';
  smtpPass: string = process.env.SMTP_PASS || '';
  smtpFrom: string = process.env.SMTP_FROM || process.env.SMTP_USER || '';

  // Application
  nodeEnv: string = process.env.NODE_ENV || 'development';
  logLevel: string = process.env.LOG_LEVEL || 'info';
  maxRetries: number = parseIntEnv('MAX_RETRIES', 3);
  queueMaxSize: number = parseIntEnv('QUEUE_MAX_SIZE', 10000);
  keepaliveInterval: number = parseIntEnv('KEEPALIVE_INTERVAL', 30);
  maxReconnectAttempts: number = parseIntEnv('MAX_RECONNECT_ATTEMPTS', 10);

  // Backoff configuration
  baseDelay: number = 1; // seconds
  maxDelay: number = 300; // 5 minutes

  validate(): void {
    const errors: string[] = [];

    if (!this.databaseUrl) {
      errors.push('DATABASE_URL is required');
    }

    // Validate based on SMS provider mode
    if (this.smsProvider === 'smpp') {
      if (!this.smppHost) errors.push('SMPP_HOST is required for SMPP mode');
      if (!this.smppSystemId) errors.push('SMPP_SYSTEM_ID is required for SMPP mode');
      if (!this.smppPassword) errors.push('SMPP_PASSWORD is required for SMPP mode');
    } else if (this.smsProvider === 'textbelt') {
      if (!this.smtpUser) errors.push('SMTP_USER is required for TextBelt mode');
      if (!this.smtpPass) errors.push('SMTP_PASS is required for TextBelt mode');
    }

    if (errors.length > 0) {
      throw new Error(`Configuration errors: ${errors.join(', ')}`);
    }
  }

  isValid(): boolean {
    try {
      this.validate();
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const config = new Config();
