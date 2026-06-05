/**
 * Create database if it doesn't exist
 */

import { Client } from 'pg';

async function createDatabase() {
  // Connect to postgres database (default)
  const client = new Client({
    host: 'localhost',
    port: 5432,
    user: 'postgres',
    password: '2002Fred??',
    database: 'postgres', // Connect to default postgres database
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');

    // Check if database exists
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'sms_provider'"
    );

    if (result.rows.length === 0) {
      // Database doesn't exist, create it
      console.log('Creating database sms_provider...');
      await client.query('CREATE DATABASE sms_provider');
      console.log('✓ Database created successfully');
    } else {
      console.log('✓ Database sms_provider already exists');
    }
  } catch (error: any) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

createDatabase();
