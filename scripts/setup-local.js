"use strict";

// Creates/updates .env for running the game on this computer.
// Only fills in values that are missing or still placeholders — never
// overwrites settings that are already configured.
//
// Run: node scripts/setup-local.js

var fs = require("fs");
var path = require("path");
var crypto = require("crypto");

var ROOT_DIR = path.resolve(__dirname, "..");
var ENV_PATH = path.join(ROOT_DIR, ".env");
var EXAMPLE_PATH = path.join(ROOT_DIR, ".env.example");
var DEFAULT_ADMIN_PASSWORD = "admin123";

function isPlaceholder(value) {
	var normalized = String(value || "").trim().replace(/^['"]|['"]$/g, "").toLowerCase();
	return normalized === "" || normalized.indexOf("replace-with-") === 0;
}

function readEnvLines() {
	if (fs.existsSync(ENV_PATH)) {
		return fs.readFileSync(ENV_PATH, "utf8").split(/\r?\n/);
	}
	if (fs.existsSync(EXAMPLE_PATH)) {
		return fs.readFileSync(EXAMPLE_PATH, "utf8").split(/\r?\n/);
	}
	return [];
}

function getValue(lines, key) {
	for (var i = 0; i < lines.length; i++) {
		var match = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
		if (match && match[1] === key) {
			return match[2].trim();
		}
	}
	return null;
}

function setValue(lines, key, value) {
	for (var i = 0; i < lines.length; i++) {
		var match = lines[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
		if (match && match[1] === key) {
			lines[i] = key + "=" + value;
			return;
		}
	}
	lines.push(key + "=" + value);
}

async function run() {
	var existed = fs.existsSync(ENV_PATH);
	var lines = readEnvLines();
	var changed = !existed;
	var createdPassword = false;

	if (isPlaceholder(getValue(lines, "PORT"))) {
		setValue(lines, "PORT", "3000");
		changed = true;
	}

	if (isPlaceholder(getValue(lines, "JWT_SECRET"))) {
		setValue(lines, "JWT_SECRET", crypto.randomBytes(32).toString("hex"));
		changed = true;
	}

	if (isPlaceholder(getValue(lines, "ADMIN_PASSWORD_HASH"))) {
		var bcrypt = require("bcryptjs");
		var hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
		setValue(lines, "ADMIN_PASSWORD_HASH", hash);
		changed = true;
		createdPassword = true;
	}

	if (changed) {
		fs.writeFileSync(ENV_PATH, lines.join("\n").replace(/\n*$/, "\n"), "utf8");
		console.log("✅ Đã tạo file cấu hình .env");
	} else {
		console.log("✅ File cấu hình .env đã có sẵn");
	}

	if (createdPassword) {
		console.log("   Mật khẩu trang quản trị (admin.html): " + DEFAULT_ADMIN_PASSWORD);
	}
}

run().catch(function (error) {
	console.error("❌ Không tạo được file .env:", error && error.message ? error.message : error);
	process.exit(1);
});
