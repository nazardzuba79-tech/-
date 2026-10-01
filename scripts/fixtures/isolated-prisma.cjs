// Disposable test child only. Services must import the SAME actual generated
// client as the harness, even when npm ci --ignore-scripts left no default client.
// This changes only this process's module cache; no shared package is written.
const { Module } = require('node:module');
module.exports = function isolatedPrisma(clientPath) {
  if (!clientPath) throw new Error('Explicit isolated Prisma client is required');
  const client = require(clientPath);
  const filename = require.resolve('@prisma/client');
  const entry = new Module(filename);
  entry.filename = filename;
  entry.exports = client;
  entry.loaded = true;
  require.cache[filename] = entry;
  return client;
};
