"use strict";

// P2-7 · KHO TÀI KHOẢN QUẢN TRỊ.
//
// Khuôn "tắt êm khi chưa có CSDL" giống `playerStore.js` / `classStore.js`: không
// có SQL client thì kho trả `disabled: true` và **đường đăng nhập bằng
// `ADMIN_PASSWORD_HASH` vẫn chạy nguyên vẹn**. Đó không phải chế độ suy giảm cho
// vui — đó chính là trạng thái của production hôm nay, trước khi ai đó chạy
// `npm run migrate`.
//
// ⚠ ĐƯỜNG DI TRÚ (đọc trước khi sửa bất cứ dòng nào ở đây):
//
//   Mật khẩu admin hiện tại của giáo viên nằm trong biến môi trường
//   `ADMIN_PASSWORD_HASH` trên Vercel. Nếu P2-7 chuyển hẳn sang bảng này mà không
//   mang hash cũ theo, thì ngay giây deploy đầu tiên giáo viên KHÔNG VÀO ĐƯỢC trang
//   quản trị của chính mình. Vì vậy:
//
//     1. `seedLegacyAccount()` chèn tài khoản `admin` từ chính hash cũ, idempotent
//        (`ON CONFLICT DO NOTHING`) — chạy lại bao nhiêu lần cũng không ghi đè mật
//        khẩu mà giáo viên đã tự đổi sau đó;
//     2. `server/app.js` VẪN chấp nhận `ADMIN_PASSWORD_HASH` cho tài khoản `admin`
//        kể cả khi bảng đã có hàng — xem chú thích "hai chìa khoá" ở đó.
//
//   Đây cùng loại rủi ro với việc bật `ANTICHEAT_ENFORCE` quá sớm (plan §10): một
//   công tắc đúng về kỹ thuật nhưng bật sai thời điểm thì khoá cửa với người dùng thật.

var bcrypt = require("bcrypt");
var adminUser = require("./adminUser");
var applySchema = require("./schema").applySchema;

var BCRYPT_ROUNDS = 10;

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

function notFound(message) {
	var error = new Error(message);
	error.statusCode = 404;
	return error;
}

function forbidden(message) {
	var error = new Error(message);
	error.statusCode = 403;
	return error;
}

/** Hàng CSDL → shape trả cho client. KHÔNG BAO GIỜ kèm `password_hash`. */
function toPublicUser(row) {
	return {
		username: row.username,
		displayName: row.display_name,
		role: row.role,
		createdAt: row.created_at,
		lastLoginAt: row.last_login_at == null ? null : row.last_login_at
	};
}

function createDisabledStore() {
	return {
		disabled: true,
		ready: function () {
			return Promise.resolve();
		},
		seedLegacyAccount: function () {
			return Promise.resolve({ ok: false, disabled: true, seeded: false });
		},
		findByUsername: function () {
			return Promise.resolve(null);
		},
		verifyLogin: function () {
			return Promise.resolve({ ok: false, disabled: true, reason: "disabled" });
		},
		listUsers: function () {
			return Promise.resolve({ users: [], disabled: true });
		},
		createUser: function () {
			return Promise.reject(badRequest("Chưa nối cơ sở dữ liệu nên chưa tạo được tài khoản quản trị."));
		},
		deleteUser: function () {
			return Promise.reject(badRequest("Chưa nối cơ sở dữ liệu nên chưa xoá được tài khoản quản trị."));
		},
		setPassword: function () {
			return Promise.reject(badRequest("Chưa nối cơ sở dữ liệu nên chưa đổi được mật khẩu."));
		},
		touchLogin: function () {
			return Promise.resolve({ ok: false, disabled: true });
		}
	};
}

function createAdminUserStore(options) {
	var sql = options && options.sql ? options.sql : null;

	if (sql == null) {
		return createDisabledStore();
	}

	var ready = options && typeof options.ready === "function" ? options.ready : null;
	var readyPromise = null;

	function whenReady() {
		if (ready !== null) {
			return ready();
		}

		if (readyPromise === null) {
			readyPromise = applySchema(sql);
		}

		return readyPromise;
	}

	function run(text, params) {
		return whenReady().then(function () {
			return sql.query(text, params || []);
		});
	}

	/**
	 * Chèn tài khoản `admin` từ `ADMIN_PASSWORD_HASH`. IDEMPOTENT.
	 *
	 * `ON CONFLICT DO NOTHING` chứ KHÔNG `DO UPDATE`: giáo viên đổi mật khẩu trong
	 * trang quản trị rồi mà lần khởi động sau bị ghi đè ngược về hash trong biến môi
	 * trường thì "đổi mật khẩu" chỉ là một cái nút trang trí.
	 */
	function seedLegacyAccount(passwordHash) {
		var hash = String(passwordHash == null ? "" : passwordHash).trim();

		if (hash === "") {
			return Promise.resolve({ ok: false, seeded: false, reason: "no-legacy-hash" });
		}

		return run(
			"INSERT INTO admin_users (username, password_hash, display_name, role) " +
			"VALUES ($1,$2,$3,'owner') ON CONFLICT (username) DO NOTHING RETURNING username",
			[adminUser.LEGACY_USERNAME, hash, "Quản trị viên"]
		).then(function (result) {
			return { ok: true, seeded: result.rows.length > 0 };
		});
	}

	function findByUsername(username) {
		var name = adminUser.normalizeUsername(username);

		if (name === "") {
			return Promise.resolve(null);
		}

		return run(
			"SELECT id, username, password_hash, display_name, role, created_at, last_login_at " +
			"FROM admin_users WHERE username = $1",
			[name]
		).then(function (result) {
			return result.rows.length > 0 ? result.rows[0] : null;
		});
	}

	/**
	 * Kiểm mật khẩu theo BẢNG. Không tìm thấy tài khoản → `reason: "no-account"` để
	 * `server/app.js` biết còn phải thử đường `ADMIN_PASSWORD_HASH` hay không.
	 *
	 * Trả về CÙNG một câu trả lời cho "không có tài khoản" và "sai mật khẩu" ở tầng
	 * HTTP — `reason` ở đây chỉ dùng nội bộ để chọn nhánh, không đi ra ngoài.
	 */
	function verifyLogin(username, password) {
		var candidate = String(password == null ? "" : password);

		if (candidate === "") {
			return Promise.resolve({ ok: false, reason: "empty" });
		}

		return findByUsername(username).then(function (row) {
			if (row == null) {
				return { ok: false, reason: "no-account" };
			}

			return bcrypt.compare(candidate, row.password_hash).then(function (matched) {
				if (matched !== true) {
					return { ok: false, reason: "bad-password" };
				}

				return { ok: true, user: toPublicUser(row) };
			});
		});
	}

	function listUsers() {
		return run(
			"SELECT username, display_name, role, created_at, last_login_at FROM admin_users " +
			"ORDER BY (role = 'owner') DESC, username ASC",
			[]
		).then(function (result) {
			return { users: result.rows.map(toPublicUser) };
		});
	}

	function createUser(actor, payload) {
		var data = payload || {};
		var username = adminUser.assertUsername(data.username);
		var role = adminUser.normalizeRole(data.role);
		var displayName = adminUser.normalizeDisplayName(data.displayName, username);
		var password = adminUser.assertPassword(data.password);
		var permission = adminUser.canManage(actor, "create", username);

		if (permission.allowed !== true) {
			throw forbidden("Chỉ tài khoản quản trị chính mới tạo được tài khoản mới.");
		}

		return bcrypt.hash(password, BCRYPT_ROUNDS).then(function (hash) {
			return run(
				"INSERT INTO admin_users (username, password_hash, display_name, role) VALUES ($1,$2,$3,$4) " +
				"ON CONFLICT (username) DO NOTHING " +
				"RETURNING username, display_name, role, created_at, last_login_at",
				[username, hash, displayName, role]
			).then(function (result) {
				if (result.rows.length === 0) {
					throw badRequest("Tên đăng nhập \"" + username + "\" đã có người dùng rồi.");
				}

				return { ok: true, user: toPublicUser(result.rows[0]) };
			});
		});
	}

	/**
	 * Xoá tài khoản.
	 *
	 * Hai lớp chắn tự khoá cửa:
	 *   · không xoá được CHÍNH MÌNH (`canManage` lo);
	 *   · không xoá được người `owner` CUỐI CÙNG — xoá xong thì không còn ai tạo
	 *     được tài khoản mới, và đường duy nhất còn lại là vào Vercel sửa biến
	 *     môi trường.
	 *
	 * Lớp học của người bị xoá KHÔNG bị xoá theo (`class_codes.owner_id` giữ nguyên
	 * chuỗi tên): tạo lại tài khoản cùng tên là nhận lại đúng các lớp cũ. Xoá lớp
	 * theo người là mất số liệu lớp học của học sinh vì một thao tác nhân sự.
	 */
	function deleteUser(actor, username) {
		var target = adminUser.normalizeUsername(username);
		var permission = adminUser.canManage(actor, "delete", target);

		if (permission.allowed !== true) {
			throw forbidden(
				permission.reason === "self-delete"
					? "Không xoá được chính tài khoản đang đăng nhập."
					: "Chỉ tài khoản quản trị chính mới xoá được tài khoản khác."
			);
		}

		return findByUsername(target).then(function (row) {
			if (row == null) {
				throw notFound("Không tìm thấy tài khoản này.");
			}

			return run("SELECT COUNT(*)::int AS total FROM admin_users WHERE role = 'owner'", []).then(function (result) {
				var owners = result.rows.length > 0 ? Number(result.rows[0].total) : 0;

				if (row.role === "owner" && owners <= 1) {
					throw badRequest("Đây là tài khoản quản trị chính duy nhất — tạo tài khoản chính khác trước đã.");
				}

				return run("DELETE FROM admin_users WHERE username = $1", [target]).then(function () {
					return { ok: true, username: target };
				});
			});
		});
	}

	function setPassword(actor, username, newPassword) {
		var target = adminUser.normalizeUsername(username);
		var password = adminUser.assertPassword(newPassword);
		var permission = adminUser.canManage(actor, "set-password", target);

		if (permission.allowed !== true) {
			throw forbidden("Tài khoản này chỉ đổi được mật khẩu của chính mình.");
		}

		return findByUsername(target).then(function (row) {
			if (row == null) {
				throw notFound("Không tìm thấy tài khoản này.");
			}

			return bcrypt.hash(password, BCRYPT_ROUNDS).then(function (hash) {
				return run(
					"UPDATE admin_users SET password_hash = $2, updated_at = now() WHERE username = $1",
					[target, hash]
				).then(function () {
					return { ok: true, username: target };
				});
			});
		});
	}

	function touchLogin(username) {
		var name = adminUser.normalizeUsername(username);

		if (name === "") {
			return Promise.resolve({ ok: false });
		}

		return run("UPDATE admin_users SET last_login_at = now() WHERE username = $1", [name]).then(function () {
			return { ok: true };
		});
	}

	/**
	 * Bọc mọi hàm có validation ĐỒNG BỘ.
	 *
	 * Khuôn `guard()` của `server/questionStore.js`: `assertUsername` ném ngay trong
	 * thân hàm async, mà lỗi ném đồng bộ trong một hàm được `await` sẽ thoát ra
	 * ngoài promise chain và làm `assert.rejects` của test thất bại.
	 */
	function guard(fn) {
		return function () {
			var args = arguments;

			return Promise.resolve().then(function () {
				return fn.apply(null, args);
			});
		};
	}

	return {
		disabled: false,
		ready: whenReady,
		seedLegacyAccount: guard(seedLegacyAccount),
		findByUsername: guard(findByUsername),
		verifyLogin: guard(verifyLogin),
		listUsers: guard(listUsers),
		createUser: guard(createUser),
		deleteUser: guard(deleteUser),
		setPassword: guard(setPassword),
		touchLogin: guard(touchLogin)
	};
}

module.exports = {
	createAdminUserStore: createAdminUserStore,
	toPublicUser: toPublicUser
};
