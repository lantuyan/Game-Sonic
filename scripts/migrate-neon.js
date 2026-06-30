"use strict";

// Applies the player-data Postgres schema (players, scores, skill_profiles) to
// the configured SQL backend.
//
//   - With DATABASE_URL set (Neon): migrates the production leaderboard database.
//   - Without DATABASE_URL (local): initializes the embedded PGlite store.
//
// The question bank is stored separately in an in-memory JSON store and needs no migration.
// Run after provisioning Neon:  node scripts/migrate-neon.js  (or: npm run migrate)

var dotenv = require("dotenv");
var configModule = require("../server/config");
var createSqlClient = require("../server/sql").createSqlClient;
var applySchema = require("../server/schema").applySchema;

dotenv.config();

(function run() {
	var config = configModule.resolveConfig();
	var sql = createSqlClient(config);

	if (sql == null) {
		console.log("No DATABASE_URL configured (and running on Vercel) — leaderboard/skill stay disabled. Nothing to migrate.");
		return;
	}

	return applySchema(sql)
		.then(function () {
			console.log("Player schema applied. Backend: " + sql.kind);

			if (sql.kind !== "neon") {
				console.log("\nNote: DATABASE_URL is not set, so this initialized the local PGlite store.");
				console.log("Set DATABASE_URL to a Neon connection string to migrate the production leaderboard.");
			}

			return sql.close();
		})
		.catch(function (error) {
			console.error("Migration failed:", error);
			process.exit(1);
		});
})();
