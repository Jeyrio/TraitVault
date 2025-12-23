import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import webhookRoutes from './routes/webhooks.js';
import apiRoutes from './routes/api.js';
import { initializeWebSocket } from './services/websocketService.js';
import pool from './config/database.js';

// Load environment variables
dotenv.config();

const app = express();
const server = createServer(app);
const PORT = process.env.PORT || 3001;

// Middleware
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
    credentials: true,
  })
);
app.use(morgan('dev'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize WebSocket
initializeWebSocket(server);

// Health check
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    await pool.query('SELECT NOW()');

    res.json({
      status: 'healthy',
      service: 'traitvault-backend',
      timestamp: new Date().toISOString(),
      database: 'connected',
      version: '1.0.0',
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});

// Routes
app.use('/webhooks', webhookRoutes);
app.use('/api', apiRoutes);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Cannot ${req.method} ${req.path}`,
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal Server Error',
    message:
      process.env.NODE_ENV === 'development'
        ? err.message
        : 'Something went wrong',
  });
});

// Start server
server.listen(PORT, () => {
  console.log('');
  console.log('🚀 TraitVault Backend Server');
  console.log('================================');
  console.log(`📡 Server running on port ${PORT}`);
  console.log(
    `🌍 Environment: ${
      process.env.NODE_ENV || 'development'
    }`
  );
  console.log(`🔌 WebSocket enabled`);
  console.log(
    `📊 Database: ${
      process.env.DATABASE_URL
        ? 'Connected'
        : 'Not configured'
    }`
  );
  console.log('================================');
  console.log('');
  console.log('Available endpoints:');
  console.log(`  GET  http://localhost:${PORT}/health`);
  console.log(
    `  POST http://localhost:${PORT}/webhooks/mint`
  );
  console.log(
    `  POST http://localhost:${PORT}/webhooks/transfer`
  );
  console.log(
    `  GET  http://localhost:${PORT}/api/collections`
  );
  console.log('');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log(
    'SIGTERM signal received: closing HTTP server'
  );
  server.close(async () => {
    console.log('HTTP server closed');
    await pool.end();
    process.exit(0);
  });
});

process.on('SIGINT', async () => {
  console.log(
    'SIGINT signal received: closing HTTP server'
  );
  server.close(async () => {
    console.log('HTTP server closed');
    await pool.end();
    process.exit(0);
  });
});
