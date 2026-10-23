import mongoose from 'mongoose';
import { env } from './config/env';
import { createApp } from './app';

async function main() {
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 15_000 });
  console.log(`Connected to MongoDB (database "${mongoose.connection.name}")`);

  const server = createApp().listen(env.PORT, () => {
    console.log(`API listening on http://localhost:${env.PORT} (allowed origins: ${env.allowedOrigins.join(', ')})`);
  });

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down`);
    server.close();
    await mongoose.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  console.error('Failed to start the API:', err instanceof Error ? err.message : err);
  process.exit(1);
});
