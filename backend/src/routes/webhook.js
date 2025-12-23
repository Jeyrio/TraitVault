import express from 'express';
import {
  handleMintEvent,
  handleTransferEvent,
} from '../services/nftService.js';

const router = express.Router();

// Middleware to verify chainhook requests
const verifyWebhook = (req, res, next) => {
  const authHeader = req.headers.authorization;
  const expectedToken = `Bearer ${process.env.CHAINHOOK_AUTH_TOKEN}`;

  if (
    process.env.NODE_ENV === 'production' &&
    authHeader !== expectedToken
  ) {
    console.warn('⚠️  Unauthorized webhook request');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  next();
};

// NFT Mint Webhook
router.post('/mint', verifyWebhook, async (req, res) => {
  try {
    console.log('📨 Received mint webhook');
    const payload = req.body;

    // Log the full payload for debugging
    console.log(
      'Payload:',
      JSON.stringify(payload, null, 2)
    );

    // Process apply array (new blocks)
    if (payload.apply && Array.isArray(payload.apply)) {
      for (const block of payload.apply) {
        console.log(
          `Processing block ${block.block_identifier.index}`
        );

        // Process transactions in the block
        if (
          block.transactions &&
          Array.isArray(block.transactions)
        ) {
          for (const tx of block.transactions) {
            await handleMintEvent(tx, block);
          }
        }
      }
    }

    // Process rollback array (chain reorg)
    if (
      payload.rollback &&
      Array.isArray(payload.rollback)
    ) {
      console.log(
        '⚠️  Chain reorganization detected - rolling back blocks'
      );
      // Handle rollback logic here if needed
    }

    res
      .status(200)
      .json({
        success: true,
        message: 'Mint events processed',
      });
  } catch (error) {
    console.error(
      '❌ Error processing mint webhook:',
      error
    );
    res.status(500).json({ error: error.message });
  }
});

// NFT Transfer Webhook
router.post(
  '/transfer',
  verifyWebhook,
  async (req, res) => {
    try {
      console.log('📨 Received transfer webhook');
      const payload = req.body;

      console.log(
        'Payload:',
        JSON.stringify(payload, null, 2)
      );

      // Process apply array
      if (payload.apply && Array.isArray(payload.apply)) {
        for (const block of payload.apply) {
          console.log(
            `Processing block ${block.block_identifier.index}`
          );

          if (
            block.transactions &&
            Array.isArray(block.transactions)
          ) {
            for (const tx of block.transactions) {
              await handleTransferEvent(tx, block);
            }
          }
        }
      }

      // Process rollback array
      if (
        payload.rollback &&
        Array.isArray(payload.rollback)
      ) {
        console.log(
          '⚠️  Chain reorganization detected - rolling back blocks'
        );
        // Handle rollback logic here if needed
      }

      res
        .status(200)
        .json({
          success: true,
          message: 'Transfer events processed',
        });
    } catch (error) {
      console.error(
        '❌ Error processing transfer webhook:',
        error
      );
      res.status(500).json({ error: error.message });
    }
  }
);

// Health check endpoint for chainhooks
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    service: 'traitvault-webhooks',
    timestamp: new Date().toISOString(),
  });
});

export default router;
