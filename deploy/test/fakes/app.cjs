// Stand-in for the server in deploy-remote.sh tests: opens the database in WAL
// mode with automatic checkpoints off, optionally bumps user_version (a schema
// migration), writes one row, signals readiness, then stays alive holding the
// connection open.
//   node app.cjs DB MIGRATE(0|1) RELEASE READY_FILE
const { DatabaseSync } = require("node:sqlite");
const fs = require("node:fs");

const [dbPath, migrate, release, readyFile] = process.argv.slice(2);
const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
if (migrate === "1") {
  const v = db.prepare("PRAGMA user_version").get().user_version;
  db.exec(`PRAGMA user_version = ${v + 1}`);
}
db.prepare("INSERT INTO t (note) VALUES (?)").run(`started ${release}`);
fs.writeFileSync(readyFile, "ready\n");
setInterval(() => {}, 1 << 30);
