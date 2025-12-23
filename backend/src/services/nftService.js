import { query, getClient } from '../config/database.js';
import { broadcastEvent } from './websocketService.js';

// Extract print events from transaction metadata
function extractPrintEvents(tx) {
  const events = [];

  if (tx.metadata && tx.metadata.receipt) {
    const receipt = tx.metadata.receipt;

    // Check for print events
    if (receipt.events && Array.isArray(receipt.events)) {
      for (const event of receipt.events) {
        if (event.type === 'print_event') {
          try {
            // Parse the print event data
            const data = event.data;
            events.push(data);
          } catch (err) {
            console.error(
              'Error parsing print event:',
              err
            );
          }
        }
      }
    }
  }

  return events;
}

// Handle NFT mint event
export async function handleMintEvent(tx, block) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const txHash = tx.transaction_identifier.hash;
    const blockHeight = block.block_identifier.index;
    const timestamp = new Date(block.timestamp * 1000);

    console.log(`Processing mint transaction: ${txHash}`);

    // Extract print events
    const printEvents = extractPrintEvents(tx);

    // Find mint event
    const mintEvent = printEvents.find(
      (e) => e.event === 'mint'
    );

    if (!mintEvent) {
      console.log('No mint event found in transaction');
      await client.query('COMMIT');
      return;
    }

    const tokenId = mintEvent['token-id'];
    const recipient = mintEvent.recipient;
    const traits = mintEvent.traits || {};

    console.log(`Minting NFT #${tokenId} to ${recipient}`);

    // Get collection ID
    const collectionResult = await client.query(
      'SELECT id FROM collections WHERE contract_address = $1',
      [process.env.NFT_CONTRACT_ADDRESS]
    );

    if (collectionResult.rows.length === 0) {
      throw new Error('Collection not found');
    }

    const collectionId = collectionResult.rows[0].id;

    // Insert NFT
    const nftResult = await client.query(
      `
      INSERT INTO nfts (collection_id, token_id, owner_address, minted_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (collection_id, token_id) DO UPDATE
      SET owner_address = $3
      RETURNING id
    `,
      [collectionId, tokenId, recipient, timestamp]
    );

    const nftId = nftResult.rows[0].id;

    // Insert traits
    for (const [traitType, traitValue] of Object.entries(
      traits
    )) {
      await client.query(
        `
        INSERT INTO traits (nft_id, trait_type, trait_value)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
        [nftId, traitType, traitValue]
      );

      // Update trait statistics
      await client.query(
        `
        INSERT INTO trait_statistics (collection_id, trait_type, trait_value, count)
        VALUES ($1, $2, $3, 1)
        ON CONFLICT (collection_id, trait_type, trait_value)
        DO UPDATE SET count = trait_statistics.count + 1
      `,
        [collectionId, traitType, traitValue]
      );
    }

    // Insert transaction record
    await client.query(
      `
      INSERT INTO transactions (nft_id, tx_hash, tx_type, to_address, block_height, timestamp)
      VALUES ($1, $2, 'mint', $3, $4, $5)
      ON CONFLICT (tx_hash) DO NOTHING
    `,
      [nftId, txHash, recipient, blockHeight, timestamp]
    );

    await client.query('COMMIT');

    console.log(
      `✅ Successfully processed mint for NFT #${tokenId}`
    );

    // Broadcast WebSocket event
    broadcastEvent('nft:minted', {
      tokenId,
      recipient,
      traits,
      txHash,
      blockHeight,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error handling mint event:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Handle NFT transfer event
export async function handleTransferEvent(tx, block) {
  const client = await getClient();

  try {
    await client.query('BEGIN');

    const txHash = tx.transaction_identifier.hash;
    const blockHeight = block.block_identifier.index;
    const timestamp = new Date(block.timestamp * 1000);

    console.log(
      `Processing transfer transaction: ${txHash}`
    );

    // Look for NFT transfer events in operations
    if (!tx.operations || tx.operations.length === 0) {
      await client.query('COMMIT');
      return;
    }

    for (const op of tx.operations) {
      if (op.type === 'NFT_TRANSFER_EVENT') {
        const tokenId = op.metadata?.token_id;
        const sender = op.metadata?.sender;
        const recipient = op.metadata?.recipient;

        if (!tokenId || !recipient) continue;

        console.log(
          `Transferring NFT #${tokenId} from ${sender} to ${recipient}`
        );

        // Get collection and NFT
        const nftResult = await client.query(
          `
          SELECT n.id, n.collection_id 
          FROM nfts n
          JOIN collections c ON n.collection_id = c.id
          WHERE c.contract_address = $1 AND n.token_id = $2
        `,
          [process.env.NFT_CONTRACT_ADDRESS, tokenId]
        );

        if (nftResult.rows.length === 0) {
          console.log(`NFT #${tokenId} not found`);
          continue;
        }

        const nftId = nftResult.rows[0].id;

        // Update NFT owner
        await client.query(
          `
          UPDATE nfts SET owner_address = $1 WHERE id = $2
        `,
          [recipient, nftId]
        );

        // Insert transaction record
        await client.query(
          `
          INSERT INTO transactions (nft_id, tx_hash, tx_type, from_address, to_address, block_height, timestamp)
          VALUES ($1, $2, 'transfer', $3, $4, $5, $6)
          ON CONFLICT (tx_hash) DO NOTHING
        `,
          [
            nftId,
            txHash,
            sender,
            recipient,
            blockHeight,
            timestamp,
          ]
        );

        console.log(
          `✅ Successfully processed transfer for NFT #${tokenId}`
        );

        // Broadcast WebSocket event
        broadcastEvent('nft:transferred', {
          tokenId,
          from: sender,
          to: recipient,
          txHash,
          blockHeight,
        });
      }
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error handling transfer event:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Calculate rarity for all NFTs in a collection
export async function calculateRarity(collectionId) {
  const client = await getClient();

  try {
    console.log(
      `🧮 Calculating rarity for collection ${collectionId}`
    );

    await client.query('BEGIN');

    // Get total supply
    const supplyResult = await client.query(
      'SELECT total_supply FROM collections WHERE id = $1',
      [collectionId]
    );

    const totalSupply = supplyResult.rows[0].total_supply;

    if (totalSupply === 0) {
      console.log('Collection is empty');
      await client.query('COMMIT');
      return;
    }

    // Calculate trait rarity scores
    await client.query(
      `
      UPDATE trait_statistics ts
      SET rarity_score = $1 / NULLIF(ts.count, 0)
      WHERE ts.collection_id = $2
    `,
      [totalSupply, collectionId]
    );

    // Calculate NFT rarity scores (sum of trait rarities)
    await client.query(
      `
      UPDATE nfts n
      SET rarity_score = (
        SELECT COALESCE(SUM(ts.rarity_score), 0)
        FROM traits t
        JOIN trait_statistics ts ON 
          ts.collection_id = n.collection_id AND
          ts.trait_type = t.trait_type AND
          ts.trait_value = t.trait_value
        WHERE t.nft_id = n.id
      )
      WHERE n.collection_id = $1
    `,
      [collectionId]
    );

    // Update rarity ranks
    await client.query(
      `
      WITH ranked AS (
        SELECT id, ROW_NUMBER() OVER (ORDER BY rarity_score DESC) as rank
        FROM nfts
        WHERE collection_id = $1
      )
      UPDATE nfts n
      SET rarity_rank = r.rank
      FROM ranked r
      WHERE n.id = r.id
    `,
      [collectionId]
    );

    await client.query('COMMIT');

    console.log(
      `✅ Rarity calculation complete for collection ${collectionId}`
    );
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error calculating rarity:', error);
    throw error;
  } finally {
    client.release();
  }
}