/**
 * Create database if it doesn't exist
 */

import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

async function createDatabase() {
  // Connect to the default postgres database to create sms_provider if needed.
  // Credentials are read from DATABASE_URL or individual env vars — never hardcoded.
  const connectionString = process.env.DATABASE_URL;

  let client: Client;

  if (connectionString) {
    // Replace the target database with 'postgres' so we can issue CREATE DATABASE
    const adminUrl = connectionString.replace(/\/[^/]+$/, '/postgres');
    client = new Client({ connectionString: adminUrl });
  } else {
    client = new Client({
      host: process.env.PGHOST || 'localhost',
      port: parseInt(process.env.PGPORT || '5432', 10),
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD,
      database: 'postgres',
    });
  }

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'sms_provider'"
    );

    if (result.rows.length === 0) {
      console.log('Creating database sms_provider...');
      await client.query('CREATE DATABASE sms_provider');
      console.log('Database created successfully');
    } else {
      console.log('Database sms_provider already exists');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

createDatabase();
