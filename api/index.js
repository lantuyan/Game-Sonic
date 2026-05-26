"use strict";

var dotenv = require("dotenv");
var createApp = require("../server/app").createApp;

dotenv.config();

var runtime = createApp();

module.exports = runtime.app;
