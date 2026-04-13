"use strict";

var bcrypt = require("bcrypt");

async function run() {
	var password = process.argv[2] || "";

	if (password.trim() === "") {
		console.error("Usage: npm run hash-password -- <plain-text-password>");
		process.exit(1);
		return;
	}

	var hash = await bcrypt.hash(password, 10);
	console.log(hash);
}

run().catch(function (error) {
	console.error(error);
	process.exit(1);
});
