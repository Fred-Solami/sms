/**
 * Database initialization script
 * Creates database schema and initial setup
 */

import { Pool } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is not set');
  process.exit(1);
}

async function initDatabase() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log('Connecting to database...');
    const client = await pool.connect();
    console.log('Connected successfully');

    // Read schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    console.log(`Reading schema from: ${schemaPath}`);
    const schema = fs.readFileSync(schemaPath, 'utf-8');

    // Execute schema
    console.log('Creating database schema...');
    await client.query(schema);
    console.log('Schema created successfully');

    // Verify tables were created
    const result = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_type = 'BASE TABLE'
      ORDER BY table_name
    `);

    console.log('\nCreated tables:');
    result.rows.forEach((row) => {
      console.log(`  - ${row.table_name}`);
    });

    // Verify enums were created
    const enumResult = await client.query(`
      SELECT typname 
      FROM pg_type 
      WHERE typtype = 'e'
      ORDER BY typname
    `);

    console.log('\nCreated enums:');
    enumResult.rows.forEach((row) => {
      console.log(`  - ${row.typname}`);
    });

    client.release();
    console.log('\nDatabase initialization completed successfully!');
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run initialization
initDatabase();
