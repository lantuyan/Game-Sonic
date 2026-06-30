"use strict";

// Applies the Postgres schema and seeds the question bank.
//
//   - With DATABASE_URL set (Neon): migrates/seeds the production database.
//   - Without DATABASE_URL: initializes the local PGlite store under .runtime.
//
// Run once after provisioning Neon (and whenever the seed JSON changes):
//   node scripts/migrate-neon.js
// Seeding is idempotent — it only inserts when the questions table is empty.

var dotenv = require("dotenv");
var configModule = require("../server/config");
var dbModule = require("../server/db");
var QuestionModel = require("../shared/questionModel");

dotenv.config();

(function run() {
	var config = configModule.resolveConfig();
	var store = dbModule.createDatabase(config);

	return store.ready()
		.then(function () {
			return Promise.all(QuestionModel.LEVELS.map(function (level) {
				return store.getLevelBundle(level).then(function (bundle) {
					return { level: level, count: bundle.questions.length };
				});
			}));
		})
		.then(function (summaries) {
			console.log("Schema applied + question bank seeded. Backend: " + store.sql.kind);
			summaries.forEach(function (item) {
				console.log("  " + item.level + ": " + item.count + " questions");
			});

			if (store.sql.kind !== "neon") {
				console.log("\nNote: DATABASE_URL is not set, so this initialized the local PGlite store.");
				console.log("Set DATABASE_URL to a Neon connection string to migrate the production database.");
			}
		})
		.then(function () {
			return store.close();
		})
		.catch(function (error) {
			console.error("Migration failed:", error);
			process.exit(1);
		});
})();
