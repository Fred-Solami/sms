/**
 * Jest global setup — silence Winston during tests so that expected
 * errors/warnings don't pollute the test output.
 */

import { logger } from '../src/utils/logger';

// Setting silent suppresses all output while keeping transports registered,
// which avoids Winston's "no transports" warning.
logger.silent = true;
