/**
 * SMS Client Factory
 * Creates the appropriate SMS client based on configuration
 */

import { config } from '../config';
import { SMPPClient } from './client';
import { TextBeltAdapter } from './textbeltAdapter';

export type SMSClient = SMPPClient | TextBeltAdapter;

export function createSMSClient(): SMSClient {
  if (config.smsProvider === 'textbelt') {
    return new TextBeltAdapter();
  } else {
    return new SMPPClient();
  }
}
