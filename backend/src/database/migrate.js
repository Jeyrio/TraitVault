import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../config/database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function migrate() {
  const client = await pool.connect();

  try {
    console.log('🚀 Starting database migration...');

    // Read schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');

    // Execute schema within a transaction
    await client.query('BEGIN');

    // Execute schema
    await client.query(schema);

    console.log('✅ Database schema created successfully');

    // Insert default collection (update with your contract address)
    const contractAddress =
      process.env.NFT_CONTRACT_ADDRESS ||
      'ST1CQYC7X5XXY6NFY043F04EAEK7MZRYSSF2Y6Z8W.traitvault';

    await client.query(
      `
      INSERT INTO collections (contract_address, name, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (contract_address) DO NOTHING
    `,
      [
        contractAddress,
        'TraitVault Collection',
        'A collection of unique NFTs with various traits tracked by TraitVault',
      ]
    );

    await client.query('COMMIT');

    console.log('✅ Default collection inserted');
    console.log('🎉 Migration completed successfully!');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
