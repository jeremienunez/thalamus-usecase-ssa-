process.setMaxListeners(Math.max(process.getMaxListeners(), 64));

void import("./sim-workers");

export {};
