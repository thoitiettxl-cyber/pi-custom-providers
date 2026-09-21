"use strict";
/** Minimal bun:sqlite stub for Node/jiti — import-safe; ops throw. */
class Database {
  constructor() {
    throw new Error("bun:sqlite is unavailable under Node Bun-shim (Pi/jiti host)");
  }
}
module.exports = { Database };
