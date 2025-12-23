import express from 'express';
import { query } from '../config/database.js';
import { calculateRarity } from '../services/nftService.js';

const router = express.Router();

// Get all collections
router.get('/collections', async (req, res) => {
  try {
    const result = await query(`
      SELECT * FROM collections
      ORDER BY created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching collections:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single collection
router.get('/collections/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      'SELECT * FROM collections WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res
        .status(404)
        .json({ error: 'Collection not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching collection:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get collection statistics
router.get('/collections/:id/stats', async (req, res) => {
  try {
    const { id } = req.params;
    const { period = '24h' } = req.query;

    // Calculate time threshold
    const hours =
      period === '24h' ? 24 : period === '7d' ? 168 : 720;
    const timeThreshold = new Date(
      Date.now() - hours * 60 * 60 * 1000
    );

    // Get various statistics
    const [
      collectionData,
      totalNFTs,
      totalHolders,
      recentMints,
      recentTransfers,
    ] = await Promise.all([
      query('SELECT * FROM collections WHERE id = $1', [
        id,
      ]),
      query(
        'SELECT COUNT(*) as count FROM nfts WHERE collection_id = $1',
        [id]
      ),
      query(
        'SELECT COUNT(DISTINCT owner_address) as count FROM nfts WHERE collection_id = $1',
        [id]
      ),
      query(
        "SELECT COUNT(*) as count FROM transactions WHERE nft_id IN (SELECT id FROM nfts WHERE collection_id = $1) AND tx_type = 'mint' AND timestamp > $2",
        [id, timeThreshold]
      ),
      query(
        "SELECT COUNT(*) as count FROM transactions WHERE nft_id IN (SELECT id FROM nfts WHERE collection_id = $1) AND tx_type = 'transfer' AND timestamp > $2",
        [id, timeThreshold]
      ),
    ]);

    res.json({
      collection: collectionData.rows[0],
      total_nfts: parseInt(totalNFTs.rows[0].count),
      total_holders: parseInt(totalHolders.rows[0].count),
      recent_mints: parseInt(recentMints.rows[0].count),
      recent_transfers: parseInt(
        recentTransfers.rows[0].count
      ),
      period,
    });
  } catch (error) {
    console.error(
      'Error fetching collection stats:',
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// Get NFTs in a collection
router.get('/collections/:id/nfts', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      sort = 'token_id',
      order = 'asc',
      limit = 100,
      offset = 0,
    } = req.query;

    // Validate sort and order
    const validSorts = [
      'token_id',
      'rarity_rank',
      'rarity_score',
      'minted_at',
    ];
    const validOrders = ['asc', 'desc'];

    const sortField = validSorts.includes(sort)
      ? sort
      : 'token_id';
    const sortOrder = validOrders.includes(order)
      ? order
      : 'asc';

    const result = await query(
      `
      SELECT 
        n.*,
        json_agg(
          json_build_object(
            'trait_type', t.trait_type,
            'trait_value', t.trait_value,
            'rarity_score', t.rarity_score
          )
        ) as traits
      FROM nfts n
      LEFT JOIN traits t ON t.nft_id = n.id
      WHERE n.collection_id = $1
      GROUP BY n.id
      ORDER BY n.${sortField} ${sortOrder}
      LIMIT $2 OFFSET $3
    `,
      [id, limit, offset]
    );

    // Get total count
    const countResult = await query(
      'SELECT COUNT(*) as total FROM nfts WHERE collection_id = $1',
      [id]
    );

    res.json({
      nfts: result.rows,
      total: parseInt(countResult.rows[0].total),
      limit: parseInt(limit),
      offset: parseInt(offset),
    });
  } catch (error) {
    console.error('Error fetching NFTs:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get single NFT
router.get(
  '/collections/:id/nfts/:tokenId',
  async (req, res) => {
    try {
      const { id, tokenId } = req.params;

      const result = await query(
        `
      SELECT 
        n.*,
        json_agg(
          json_build_object(
            'trait_type', t.trait_type,
            'trait_value', t.trait_value,
            'rarity_score', t.rarity_score
          )
        ) as traits
      FROM nfts n
      LEFT JOIN traits t ON t.nft_id = n.id
      WHERE n.collection_id = $1 AND n.token_id = $2
      GROUP BY n.id
    `,
        [id, tokenId]
      );

      if (result.rows.length === 0) {
        return res
          .status(404)
          .json({ error: 'NFT not found' });
      }

      // Get transaction history
      const txResult = await query(
        `
      SELECT * FROM transactions
      WHERE nft_id = $1
      ORDER BY timestamp DESC
    `,
        [result.rows[0].id]
      );

      res.json({
        ...result.rows[0],
        transactions: txResult.rows,
      });
    } catch (error) {
      console.error('Error fetching NFT:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Search NFTs by traits
router.post(
  '/collections/:id/nfts/search',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { traits } = req.body;

      if (!traits || typeof traits !== 'object') {
        return res
          .status(400)
          .json({ error: 'Invalid traits filter' });
      }

      // Build dynamic query
      let conditions = ['n.collection_id = $1'];
      let params = [id];
      let paramIndex = 2;

      for (const [traitType, traitValue] of Object.entries(
        traits
      )) {
        conditions.push(`
        EXISTS (
          SELECT 1 FROM traits t 
          WHERE t.nft_id = n.id 
          AND t.trait_type = $${paramIndex} 
          AND t.trait_value = $${paramIndex + 1}
        )
      `);
        params.push(traitType, traitValue);
        paramIndex += 2;
      }

      const queryText = `
      SELECT 
        n.*,
        json_agg(
          json_build_object(
            'trait_type', t.trait_type,
            'trait_value', t.trait_value,
            'rarity_score', t.rarity_score
          )
        ) as traits
      FROM nfts n
      LEFT JOIN traits t ON t.nft_id = n.id
      WHERE ${conditions.join(' AND ')}
      GROUP BY n.id
      ORDER BY n.rarity_rank ASC
    `;

      const result = await query(queryText, params);

      res.json({
        nfts: result.rows,
        count: result.rows.length,
      });
    } catch (error) {
      console.error('Error searching NFTs:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Calculate rarity for collection
router.post(
  '/collections/:id/calculate-rarity',
  async (req, res) => {
    try {
      const { id } = req.params;

      await calculateRarity(id);

      res.json({
        success: true,
        message: 'Rarity calculation completed',
      });
    } catch (error) {
      console.error('Error calculating rarity:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

// Get trait distribution
router.get(
  '/collections/:id/traits/distribution',
  async (req, res) => {
    try {
      const { id } = req.params;

      const result = await query(
        `
      SELECT 
        trait_type,
        trait_value,
        count,
        rarity_score,
        floor_price
      FROM trait_statistics
      WHERE collection_id = $1
      ORDER BY trait_type, count DESC
    `,
        [id]
      );

      // Group by trait type
      const distribution = {};
      for (const row of result.rows) {
        if (!distribution[row.trait_type]) {
          distribution[row.trait_type] = [];
        }
        distribution[row.trait_type].push({
          value: row.trait_value,
          count: row.count,
          rarity_score: row.rarity_score,
          floor_price: row.floor_price,
        });
      }

      res.json(distribution);
    } catch (error) {
      console.error(
        'Error fetching trait distribution:',
        error
      );
      res.status(500).json({ error: error.message });
    }
  }
);

// Get holder analytics
router.get('/collections/:id/holders', async (req, res) => {
  try {
    const { id } = req.params;
    const { limit = 100 } = req.query;

    const result = await query(
      `
      SELECT 
        holder_address,
        nft_count,
        total_value,
        first_acquired_at,
        last_acquired_at
      FROM holders
      WHERE collection_id = $1
      ORDER BY nft_count DESC
      LIMIT $2
    `,
      [id, limit]
    );

    // Get total holders count
    const countResult = await query(
      'SELECT COUNT(*) as total FROM holders WHERE collection_id = $1',
      [id]
    );

    res.json({
      holders: result.rows,
      total_holders: parseInt(countResult.rows[0].total),
    });
  } catch (error) {
    console.error(
      'Error fetching holder analytics:',
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// Get recent activity
router.get(
  '/collections/:id/activity',
  async (req, res) => {
    try {
      const { id } = req.params;
      const { limit = 50 } = req.query;

      const result = await query(
        `
      SELECT 
        t.*,
        n.token_id
      FROM transactions t
      JOIN nfts n ON n.id = t.nft_id
      WHERE n.collection_id = $1
      ORDER BY t.timestamp DESC
      LIMIT $2
    `,
        [id, limit]
      );

      res.json(result.rows);
    } catch (error) {
      console.error('Error fetching activity:', error);
      res.status(500).json({ error: error.message });
    }
  }
);

export default router;
