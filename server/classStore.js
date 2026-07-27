"use strict";

// P2-5 · LỚP HỌC — kho dữ liệu cho mã lớp và thành viên lớp.
//
// Ba bất biến của file này, viết ra để người sửa sau không phải đoán:
//
//   1. **Mọi truy vấn của giáo viên đều kèm `owner_id`.** Không có hàm nào nhận
//      `classId` mà không nhận `ownerId`. Đó là cách duy nhất bảo đảm "giáo viên A
//      không xem được lớp của giáo viên B" mà không phải nhớ kiểm ở từng route.
//   2. **Không tìm thấy và không có quyền trả về CÙNG MỘT kết quả** (`not-found`).
//      Phân biệt hai thứ đó là tự xác nhận "lớp này có tồn tại, chỉ là của người
//      khác" — một rò rỉ nhỏ nhưng miễn phí cho người dò.
//   3. **Mã lớp chỉ mở cửa GHI, không mở cửa ĐỌC.** Biết mã thì gắn được máy của
//      mình vào lớp; không có đường nào từ mã lớp đọc ra số liệu của lớp. Toàn bộ
//      đường đọc số liệu nằm sau `requireAdminAuth`. (docs/v2/P2-5-PRIVACY.md §4)
//
// Khuôn "tắt êm khi chưa có CSDL" giống `playerStore.js`/`statsStore.js`: không có
// Neon thì mọi thứ trả `disabled: true` và game vẫn chơi trọn vẹn.

var QuestionModel = require("../shared/questionModel");
var classCode = require("./classCode");
var applySchema = require("./schema").applySchema;

var MAX_DEVICE_ID_LENGTH = 64;
var MAX_CODE_ATTEMPTS = 5;
var DEFAULT_OWNER_ID = "admin";

function badRequest(message) {
	var error = new Error(message);
	error.statusCode = 400;
	return error;
}

function requireDeviceId(value) {
	var deviceId = String(value == null ? "" : value).trim();

	if (deviceId === "" || deviceId.length > MAX_DEVICE_ID_LENGTH) {
		throw badRequest("A valid deviceId is required.");
	}

	return deviceId;
}

function requireOwnerId(value) {
	var ownerId = String(value == null ? "" : value).trim();

	if (ownerId === "") {
		throw badRequest("Missing owner.");
	}

	return ownerId;
}

function requireClassId(value) {
	var id = Number(value);

	if (isFinite(id) === false || Math.floor(id) !== id || id <= 0) {
		throw badRequest("Mã lớp không hợp lệ.");
	}

	return id;
}

function normalizeLevel(value) {
	if (value == null || String(value).trim() === "") {
		return null;
	}

	QuestionModel.assertLevel(String(value).trim());
	return String(value).trim();
}

/** Hàng CSDL → shape trả về cho admin. `code` chỉ lộ cho CHỦ lớp. */
function toClassRow(row) {
	var value = {
		id: Number(row.id),
		code: row.code,
		codeDisplay: classCode.formatCode(row.code),
		label: row.label,
		level: row.level == null ? null : row.level,
		expiresAt: row.expires_at,
		revokedAt: row.revoked_at == null ? null : row.revoked_at,
		createdAt: row.created_at,
		memberCount: row.member_count == null ? 0 : Number(row.member_count)
	};

	value.status = classCode.describeStatus(value, new Date());
	return value;
}

/** Shape trả về cho HỌC SINH — cố ý KHÔNG có `code`, không có số thành viên. */
function toStudentClass(row) {
	return {
		id: Number(row.id),
		label: row.label,
		level: row.level == null ? null : row.level,
		status: classCode.describeStatus(
			{ revokedAt: row.revoked_at == null ? null : row.revoked_at, expiresAt: row.expires_at },
			new Date()
		)
	};
}

function createDisabledClassStore() {
	function disabled() {
		return Promise.resolve({ ok: false, disabled: true, reason: "disabled" });
	}

	return {
		disabled: true,
		createClass: disabled,
		listClasses: function () {
			return Promise.resolve({ classes: [], disabled: true });
		},
		getOwnedClass: function () {
			return Promise.resolve(null);
		},
		revokeClass: disabled,
		deleteClass: disabled,
		listMembers: function () {
			return Promise.resolve({ members: [], disabled: true });
		},
		removeMember: disabled,
		joinByCode: disabled,
		getMembership: function () {
			return Promise.resolve({ class: null, disabled: true });
		},
		leaveClass: function () {
			return Promise.resolve({ ok: true, left: 0, disabled: true });
		}
	};
}

function createClassStore(options) {
	var sql = options && options.sql ? options.sql : null;

	if (sql == null) {
		return createDisabledClassStore();
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
	 * Tạo lớp mới. Va chạm mã là gần như không thể (2^40) nhưng vẫn thử lại vài
	 * lần thay vì ném lỗi: một lần va chạm không đáng để giáo viên phải bấm lại.
	 */
	function createClass(ownerId, payload) {
		var owner = requireOwnerId(ownerId);
		var data = payload || {};
		var label = classCode.normalizeLabel(data.label);
		var level = normalizeLevel(data.level);
		var days = classCode.normalizeExpiresInDays(data.expiresInDays);

		function attempt(remaining) {
			var code = classCode.generateCode();

			return run(
				"INSERT INTO class_codes (code, owner_id, label, level, expires_at) " +
				"VALUES ($1,$2,$3,$4, now() + ($5::int * INTERVAL '1 day')) " +
				"ON CONFLICT (code) DO NOTHING " +
				"RETURNING id, code, owner_id, label, level, expires_at, revoked_at, created_at",
				[code, owner, label, level, days]
			).then(function (result) {
				if (result.rows.length > 0) {
					return { ok: true, class: toClassRow(result.rows[0]) };
				}

				if (remaining <= 1) {
					throw badRequest("Không sinh được mã lớp mới, thầy cô thử lại giúp.");
				}

				return attempt(remaining - 1);
			});
		}

		return attempt(MAX_CODE_ATTEMPTS);
	}

	/** Danh sách lớp CỦA MỘT chủ sở hữu. Không có đường nào liệt kê "mọi lớp". */
	function listClasses(ownerId) {
		var owner = requireOwnerId(ownerId);

		return run(
			"SELECT c.id, c.code, c.owner_id, c.label, c.level, c.expires_at, c.revoked_at, c.created_at, " +
				"(SELECT COUNT(*) FROM class_members m WHERE m.class_id = c.id) AS member_count " +
			"FROM class_codes c WHERE c.owner_id = $1 ORDER BY c.created_at DESC",
			[owner]
		).then(function (result) {
			return { classes: result.rows.map(toClassRow) };
		});
	}

	/** null = không tồn tại HOẶC không phải lớp của người này (cố ý không phân biệt). */
	function getOwnedClass(ownerId, classId) {
		var owner = requireOwnerId(ownerId);
		var id = requireClassId(classId);

		return run(
			"SELECT id, code, owner_id, label, level, expires_at, revoked_at, created_at " +
			"FROM class_codes WHERE id = $1 AND owner_id = $2",
			[id, owner]
		).then(function (result) {
			return result.rows.length > 0 ? toClassRow(result.rows[0]) : null;
		});
	}

	/**
	 * Thu hồi = đóng cửa VÀO lớp, không phải xoá lớp.
	 *
	 * Thành viên cũ giữ nguyên, số liệu đã có giữ nguyên. Đây đúng là việc cần làm
	 * khi mã bị lộ: khoá mã cũ, phát mã mới, rồi gỡ những máy lạ đã kịp vào.
	 */
	function revokeClass(ownerId, classId) {
		var owner = requireOwnerId(ownerId);
		var id = requireClassId(classId);

		return run(
			"UPDATE class_codes SET revoked_at = COALESCE(revoked_at, now()) " +
			"WHERE id = $1 AND owner_id = $2 " +
			"RETURNING id, code, owner_id, label, level, expires_at, revoked_at, created_at",
			[id, owner]
		).then(function (result) {
			if (result.rows.length === 0) {
				return { ok: false, reason: "not-found" };
			}

			return { ok: true, class: toClassRow(result.rows[0]) };
		});
	}

	/**
	 * Xoá lớp = TRẢ DỮ LIỆU VỀ ẨN DANH.
	 *
	 * `answer_events.class_id` về NULL chứ không xoá dòng: số câu đúng/sai của các
	 * em vẫn còn trong thống kê toàn trường (đó là dữ liệu học tập, không phải dữ
	 * liệu định danh), chỉ mất liên kết tới lớp. Xoá dòng là vừa mất dữ liệu dạy
	 * học vừa không cần thiết cho quyền riêng tư.
	 *
	 * Ba câu trong MỘT transaction, và cả ba đều tự kiểm quyền sở hữu bằng chính
	 * mệnh đề con — không có khe TOCTOU giữa "kiểm quyền" và "xoá".
	 */
	function deleteClass(ownerId, classId) {
		var owner = requireOwnerId(ownerId);
		var id = requireClassId(classId);
		var ownedSubquery = "(SELECT id FROM class_codes WHERE id = $1 AND owner_id = $2)";

		return whenReady().then(function () {
			return sql.batch([
				{
					text: "UPDATE answer_events SET class_id = NULL WHERE class_id IN " + ownedSubquery,
					params: [id, owner]
				},
				{
					text: "DELETE FROM class_members WHERE class_id IN " + ownedSubquery,
					params: [id, owner]
				},
				{
					text: "DELETE FROM class_codes WHERE id = $1 AND owner_id = $2 RETURNING id",
					params: [id, owner]
				}
			]);
		}).then(function (results) {
			var deleted = results[results.length - 1];

			if (deleted == null || deleted.rows.length === 0) {
				return { ok: false, reason: "not-found" };
			}

			return { ok: true, deleted: 1 };
		});
	}

	/**
	 * Danh sách máy trong lớp.
	 *
	 * ⚠ CHỖ NHẠY CẢM NHẤT của cả task. Trả về `deviceId` (rút gọn ở giao diện),
	 * `joinedAt` và `nickname` — biệt danh vốn đã công khai trên bảng xếp hạng, và
	 * giáo viên cần một cái tên để biết máy nào cần gỡ khi mã bị lộ. KHÔNG trả về
	 * điểm số hay tỉ lệ đúng của từng em: dashboard giữ nguyên mức TỔNG HỢP, không
	 * dựng hồ sơ học lực theo tên. Lý do đầy đủ: docs/v2/P2-5-PRIVACY.md §3.
	 */
	function listMembers(ownerId, classId) {
		var owner = requireOwnerId(ownerId);
		var id = requireClassId(classId);

		return run(
			"SELECT m.device_id, m.joined_at, p.nickname " +
			"FROM class_members m " +
			"LEFT JOIN players p ON p.device_id = m.device_id " +
			"WHERE m.class_id IN (SELECT id FROM class_codes WHERE id = $1 AND owner_id = $2) " +
			"ORDER BY m.joined_at ASC",
			[id, owner]
		).then(function (result) {
			return {
				members: result.rows.map(function (row) {
					return {
						deviceId: row.device_id,
						nickname: row.nickname == null ? null : row.nickname,
						joinedAt: row.joined_at
					};
				})
			};
		});
	}

	/**
	 * Gỡ một máy khỏi lớp — đường xử lý sự cố "mã lộ, người lạ vào lớp".
	 *
	 * Gỡ thì XOÁ LUÔN liên kết của dữ liệu đã ghi (`class_id` về NULL). Nếu chỉ
	 * chặn từ nay trở đi thì phần dữ liệu người lạ đã bơm vào vẫn nằm trong thống
	 * kê của lớp, và giáo viên không có cách nào lấy nó ra.
	 */
	function removeMember(ownerId, classId, deviceId) {
		var owner = requireOwnerId(ownerId);
		var id = requireClassId(classId);
		var device = requireDeviceId(deviceId);
		var ownedSubquery = "(SELECT id FROM class_codes WHERE id = $1 AND owner_id = $2)";

		return whenReady().then(function () {
			return sql.batch([
				{
					text: "UPDATE answer_events SET class_id = NULL WHERE device_id = $3 AND class_id IN " + ownedSubquery,
					params: [id, owner, device]
				},
				{
					text: "DELETE FROM class_members WHERE device_id = $3 AND class_id IN " + ownedSubquery + " RETURNING device_id",
					params: [id, owner, device]
				}
			]);
		}).then(function (results) {
			var removed = results[results.length - 1];

			if (removed == null || removed.rows.length === 0) {
				return { ok: false, reason: "not-found" };
			}

			return { ok: true, removed: 1 };
		});
	}

	/**
	 * Học sinh nhập mã.
	 *
	 * Mã sai / hết hạn / bị thu hồi đều trả 200 kèm `ok:false` + `reason` — đây là
	 * câu trả lời bình thường của một ô nhập liệu, không phải lỗi giao thức (cùng
	 * khuôn `POST /api/players/:id/purchases` của P2-3). Client dịch `reason` sang
	 * câu tiếng Việt cho các em.
	 */
	function joinByCode(deviceId, payload) {
		var device = requireDeviceId(deviceId);
		var data = payload || {};
		var code = classCode.normalizeCode(data.code);

		if (code === "") {
			return Promise.resolve({ ok: false, reason: "invalid" });
		}

		return run(
			"SELECT id, code, owner_id, label, level, expires_at, revoked_at, created_at FROM class_codes WHERE code = $1",
			[code]
		).then(function (result) {
			if (result.rows.length === 0) {
				return { ok: false, reason: "not-found" };
			}

			var row = result.rows[0];

			if (row.revoked_at != null) {
				return { ok: false, reason: "revoked" };
			}

			if (new Date(row.expires_at).getTime() <= Date.now()) {
				return { ok: false, reason: "expired" };
			}

			// Nhập mã lớp mới = CHUYỂN lớp (khoá chính là device_id). Nhập lại đúng
			// mã cũ chỉ làm mới `joined_at`, không tạo dòng thứ hai.
			return run(
				"INSERT INTO class_members (device_id, class_id) VALUES ($1,$2) " +
				"ON CONFLICT (device_id) DO UPDATE SET class_id = EXCLUDED.class_id, joined_at = now()",
				[device, Number(row.id)]
			).then(function () {
				return { ok: true, class: toStudentClass(row) };
			});
		});
	}

	/** Lớp hiện tại của một máy. Chỉ trả tên lớp — không bao giờ trả danh sách bạn cùng lớp. */
	function getMembership(deviceId) {
		var device = requireDeviceId(deviceId);

		return run(
			"SELECT c.id, c.label, c.level, c.expires_at, c.revoked_at, m.joined_at " +
			"FROM class_members m JOIN class_codes c ON c.id = m.class_id WHERE m.device_id = $1",
			[device]
		).then(function (result) {
			if (result.rows.length === 0) {
				return { class: null };
			}

			var row = result.rows[0];
			var value = toStudentClass(row);
			value.joinedAt = row.joined_at;

			return { class: value };
		});
	}

	/**
	 * Học sinh tự rời lớp.
	 *
	 * Rời lớp CHỈ dừng gắn dữ liệu từ nay về sau; số liệu đã ghi vẫn thuộc lớp.
	 * Cố ý bất đối xứng với "giáo viên gỡ khỏi lớp" (xoá cả liên kết cũ): rời lớp
	 * là việc bình thường cuối năm học, và cho một em xoá ngược số liệu tổng hợp
	 * của cả lớp là mở đúng một đường làm hỏng dữ liệu dạy học. Em nào muốn gỡ cả
	 * phần đã ghi thì báo thầy cô bấm "Gỡ khỏi lớp" — có ghi trong tài liệu rà soát.
	 */
	function leaveClass(deviceId) {
		var device = requireDeviceId(deviceId);

		return run("DELETE FROM class_members WHERE device_id = $1 RETURNING device_id", [device]).then(function (result) {
			return { ok: true, left: result.rows.length };
		});
	}

	/**
	 * Mọi phương thức trả về Promise, nên lỗi kiểm tra đầu vào cũng phải là REJECT
	 * chứ không throw đồng bộ — cùng lý do đã ghi ở `server/questionStore.js`:
	 * giao diện nửa-đồng-bộ-nửa-bất-đồng-bộ làm người gọi dùng `.catch()` để lọt
	 * đúng những lỗi hay gặp nhất.
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
		createClass: guard(createClass),
		listClasses: guard(listClasses),
		getOwnedClass: guard(getOwnedClass),
		revokeClass: guard(revokeClass),
		deleteClass: guard(deleteClass),
		listMembers: guard(listMembers),
		removeMember: guard(removeMember),
		joinByCode: guard(joinByCode),
		getMembership: guard(getMembership),
		leaveClass: guard(leaveClass)
	};
}

module.exports = {
	createClassStore: createClassStore,
	DEFAULT_OWNER_ID: DEFAULT_OWNER_ID
};
