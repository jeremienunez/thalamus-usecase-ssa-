// Must be imported FIRST, before fastify/pg/ioredis/thalamus/sweep etc.
// Those libs collectively register ~11 process exit/SIGINT handlers at
// import time, which trips Node's default MaxListeners=10 warning.
process.setMaxListeners(20);
