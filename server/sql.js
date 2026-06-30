"use strict";

// Unified async SQL client over a single Postgres dialect.
//
//   - Production: Neon (HTTP driver) when DATABASE_URL is a Neon connection
//     string. No WebSocket needed, works on Vercel serverless.
//   - Local dev / tests / Vercel-without-DATABASE_URL: PGlite, an embedded
//     Postgres (WASM). File-backed so data survives in-process restarts;
//     in-memory when no data dir is provided.
//
// Both backends speak the same Postgres SQL ($1 placeholders) and expose:
//   query(text, params)   -> Promise<{ rows }>
//   batch([{text,params}]) -> Promise<Array<{ rows }>>   (atomic transaction)
//   close()               -> Promise
//   kind                  -> "neon" | "pglite"

var fs = require("fs");
var path = require("path");

function hasDatabaseUrl(value) {
	return typeof value === "string" && value.trim() !== "";
}

function normalizeResult(result) {
	if (result == null) {
		return { rows: [] };
	}

	if (Array.isArray(result)) {
		return { rows: result };
	}

	if (Array.isArray(result.rows)) {
		return { rows: result.rows };
	}

	return { rows: [] };
}

function createNeonClient(databaseUrl) {
	var neon = require("@neondatabase/serverless").neon;
	var sql = neon(databaseUrl);

	return {
		kind: "neon",
		query: function (text, params) {
			return Promise.resolve(sql.query(text, params || [])).then(normalizeResult);
		},
		batch: function (items) {
			var queries = items.map(function (item) {
				return sql.query(item.text, item.params || []);
			});

			return Promise.resolve(sql.transaction(queries)).then(function (results) {
				return (results || []).map(normalizeResult);
			});
		},
		close: function () {
			return Promise.resolve();
		}
	};
}

// PGlite clients are cached per data dir. A given data dir maps to one embedded
// instance for the lifetime of the process. This (a) lets repeated createApp()
// calls and warm serverless invocations reuse the already-seeded database, and
// (b) avoids a WASM teardown race that fires a late "PGlite is closed" rejection
// when a data dir is closed and immediately reopened. close() is therefore a
// no-op for PGlite; the instance is reclaimed on process exit.
var pgliteClientsByDir = new Map();

function buildPgliteClient(config) {
	var PGlite = require("@electric-sql/pglite").PGlite;
	var dataDir = config && config.pgDataDir ? config.pgDataDir : null;

	if (dataDir) {
		fs.mkdirSync(path.dirname(dataDir), { recursive: true });
	}

	var dbPromise = (function () {
		var db = dataDir ? new PGlite(dataDir) : new PGlite();
		return Promise.resolve(db.waitReady).then(function () {
			return db;
		});
	})();

	return {
		kind: "pglite",
		query: function (text, params) {
			return dbPromise.then(function (db) {
				return db.query(text, params || []);
			}).then(normalizeResult);
		},
		batch: function (items) {
			return dbPromise.then(function (db) {
				return db.transaction(function (tx) {
					var results = [];
					var chain = Promise.resolve();

					items.forEach(function (item) {
						chain = chain.then(function () {
							return tx.query(item.text, item.params || []);
						}).then(function (result) {
							results.push(normalizeResult(result));
						});
					});

					return chain.then(function () {
						return results;
					});
				});
			});
		},
		close: function () {
			return Promise.resolve();
		}
	};
}

function createPgliteClient(config) {
	var dataDir = config && config.pgDataDir ? config.pgDataDir : null;

	if (dataDir && pgliteClientsByDir.has(dataDir)) {
		return pgliteClientsByDir.get(dataDir);
	}

	var client = buildPgliteClient(config);

	if (dataDir) {
		pgliteClientsByDir.set(dataDir, client);
	}

	return client;
}

function createSqlClient(config) {
	var databaseUrl = config && config.databaseUrl != null ? config.databaseUrl : process.env.DATABASE_URL;

	if (hasDatabaseUrl(databaseUrl)) {
		return createNeonClient(databaseUrl);
	}

	// No Neon connection string. PGlite (embedded WASM Postgres) is only used for
	// local dev and tests — it hangs inside Vercel's serverless function runtime,
	// so on Vercel we return null and let DB-backed features (leaderboard/skill)
	// stay disabled until DATABASE_URL is configured. The question bank does not
	// use this client; it runs on an in-memory JSON store and works on Vercel with no config.
	if (String(process.env.VERCEL || "") !== "") {
		return null;
	}

	return createPgliteClient(config || {});
}

module.exports = {
	createSqlClient: createSqlClient
};
