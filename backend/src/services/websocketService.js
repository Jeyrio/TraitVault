import { Server } from 'socket.io';

let io;

export function initializeWebSocket(server) {
  io = new Server(server, {
    cors: {
      origin:
        process.env.ALLOWED_ORIGINS?.split(',') || '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`✅ Client connected: ${socket.id}`);

    // Handle collection subscription
    socket.on('subscribe:collection', (collectionId) => {
      const room = `collection:${collectionId}`;
      socket.join(room);
      console.log(
        `Client ${socket.id} subscribed to ${room}`
      );
    });

    // Handle unsubscribe
    socket.on('unsubscribe:collection', (collectionId) => {
      const room = `collection:${collectionId}`;
      socket.leave(room);
      console.log(
        `Client ${socket.id} unsubscribed from ${room}`
      );
    });

    socket.on('disconnect', () => {
      console.log(`Client disconnected: ${socket.id}`);
    });
  });

  console.log('✅ WebSocket server initialized');

  return io;
}

export function broadcastEvent(eventName, data) {
  if (!io) {
    console.warn('WebSocket not initialized');
    return;
  }

  // Broadcast to all connected clients
  io.emit(eventName, data);

  // Also broadcast to specific collection room if collectionId is provided
  if (data.collectionId) {
    io.to(`collection:${data.collectionId}`).emit(
      eventName,
      data
    );
  }
}

export function getIO() {
  return io;
}
