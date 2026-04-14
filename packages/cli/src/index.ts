#!/usr/bin/env node
import { main } from "./boot";
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
