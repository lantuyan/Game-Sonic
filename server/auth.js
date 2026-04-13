"use strict";

var bcrypt = require("bcrypt");
var jwt = require("jsonwebtoken");

function getCookieOptions(config) {
	return {
		httpOnly: true,
		sameSite: "lax",
		secure: config.nodeEnv === "production",
		path: "/"
	};
}

function createAdminToken(config) {
	return jwt.sign(
		{
			role: "admin"
		},
		config.jwtSecret,
		{
			expiresIn: config.jwtExpiresIn
		}
	);
}

function setAdminCookie(response, token, config) {
	response.cookie(config.cookieName, token, getCookieOptions(config));
}

function clearAdminCookie(response, config) {
	response.clearCookie(config.cookieName, getCookieOptions(config));
}

async function verifyAdminPassword(password, config) {
	if (typeof password !== "string" || password === "") {
		return false;
	}

	return bcrypt.compare(password, config.adminPasswordHash);
}

function readAdminClaims(request, config) {
	var token = request.cookies ? request.cookies[config.cookieName] : "";

	if (typeof token !== "string" || token === "") {
		return null;
	}

	try {
		return jwt.verify(token, config.jwtSecret);
	} catch (error) {
		return null;
	}
}

function isAuthenticated(request, config) {
	return readAdminClaims(request, config) != null;
}

function requireAdminAuth(config) {
	return function (request, response, next) {
		if (isAuthenticated(request, config) !== true) {
			response.status(401).json({
				error: "Admin authentication required."
			});
			return;
		}

		next();
	};
}

module.exports = {
	clearAdminCookie: clearAdminCookie,
	createAdminToken: createAdminToken,
	isAuthenticated: isAuthenticated,
	requireAdminAuth: requireAdminAuth,
	setAdminCookie: setAdminCookie,
	verifyAdminPassword: verifyAdminPassword
};
