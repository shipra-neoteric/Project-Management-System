/**
 * Runs the API against a throw-away in-memory MongoDB — handy for trying the app
 * before MongoDB Atlas is set up. Data is lost when the process stops.
 *
 *   npm run dev:memory
 */
import { MongoMemoryServer } from 'mongodb-memory-server-core';

async function main() {
  const mongo = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongo.getUri('pms');
  process.env.JWT_SECRET ??= 'local-demo-secret-local-demo-secret-123456';
  console.log('In-memory MongoDB started (data is NOT saved when you stop this process)');
  await import('../src/index');
}

void main();
