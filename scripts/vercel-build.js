"use strict";

var fs = require("fs");
var path = require("path");

var rootDir = path.resolve(__dirname, "..");
var publicDir = path.join(rootDir, "public");
var staticFiles = [
	"EndlessRunner.htm",
	"EndlessRunner.js",
	"EndlessRunner.json",
	"EndlessRunner.png",
	"EndlessRunnerFavIcon_16x16.png",
	"EndlessRunnerFavIcon_192x192.png",
	"EndlessRunnerFavIcon_512x512.png",
	"EndlessRunnerShare.png",
	"admin.html",
	"index.html",
	"questionBank.js",
	"worker.js"
];

// The deploy build only assembles static assets. Tests run via `npm test`
// (locally / CI), not in the deploy build, so a flaky integration test can't
// block a production deploy.
fs.rmSync(publicDir, { recursive: true, force: true });
fs.mkdirSync(publicDir, { recursive: true });

staticFiles.forEach(function (fileName) {
	fs.copyFileSync(path.join(rootDir, fileName), path.join(publicDir, fileName));
});

// Copy selectable character models (3D GLB) so they are served as static assets.
var charactersSrc = path.join(rootDir, "characters");
if (fs.existsSync(charactersSrc)) {
	fs.cpSync(charactersSrc, path.join(publicDir, "characters"), { recursive: true });
}
