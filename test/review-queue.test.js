"use strict";

// P0-10 — vòng đời hàng đợi ôn câu sai:
//   vào queue khi sai → gặp lại ở ván sau → ra khỏi queue sau 2 lần đúng.
// Kèm 2 bẫy dễ sai: trần 30 câu (FIFO) và HƯỚNG trộn vào hàng đợi (pop từ cuối).

var test = require("node:test");
var assert = require("node:assert/strict");
var helpers = require("../test-helpers/clientModule");
var loadClientModule = helpers.loadClientModule;

// localStorage giả — cài ĐÚNG MỘT LẦN, TRƯỚC mọi lần nạp module.
//
// `core/SaveData.ts` chụp `window.localStorage` ngay lúc module được đánh giá
// (`const storage = readStorage()`), còn `loadClientModule` thì cache module. Nếu
// mỗi test cài một stub mới thì module vẫn giữ stub CŨ và mọi lần ghi rơi vào
// Map cũ — nên ở đây dùng chung một store và chỉ xoá nội dung giữa các test.
var sharedStore = new Map();

globalThis.window = {
	localStorage: {
		getItem: function (key) {
			return sharedStore.has(key) ? sharedStore.get(key) : null;
		},
		setItem: function (key, value) {
			sharedStore.set(key, String(value));
		},
		removeItem: function (key) {
			sharedStore.delete(key);
		}
	}
};

function installStorage() {
	sharedStore.clear();

	return {
		raw: sharedStore,
		restore: function () {
			sharedStore.clear();
		}
	};
}

async function freshQueue() {
	var module = await loadClientModule("systems/ReviewQueue.ts");
	return new module.ReviewQueue();
}

test("câu sai vào queue, đúng 2 lần thì ra khỏi queue", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();

		queue.recordWrong("q1", "lop6", 1000);
		assert.equal(queue.has("q1"), true, "sai thì phải vào queue");
		assert.equal(queue.all.length, 1);

		// Đúng lần 1: vẫn còn trong queue.
		assert.equal(queue.recordCorrect("q1", 2000), false);
		assert.equal(queue.has("q1"), true, "đúng 1 lần CHƯA đủ để ra");

		// Đúng lần 2: tốt nghiệp.
		assert.equal(queue.recordCorrect("q1", 3000), true);
		assert.equal(queue.has("q1"), false, "đúng 2 lần thì ra khỏi queue");
		assert.equal(queue.all.length, 0);
	} finally {
		storage.restore();
	}
});

test("sai lại giữa chừng thì mất hết tiến độ, phải đúng lại từ đầu", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();

		queue.recordWrong("q1", "lop6", 1000);
		queue.recordCorrect("q1", 2000);

		var entry = queue.all.find(function (item) { return item.questionId === "q1"; });
		assert.equal(entry.correctStreak, 1);

		queue.recordWrong("q1", "lop6", 3000);
		entry = queue.all.find(function (item) { return item.questionId === "q1"; });
		assert.equal(entry.correctStreak, 0, "sai lại phải reset chuỗi đúng");
		assert.equal(entry.wrongCount, 2, "đếm số lần sai để P1 xếp ưu tiên");

		// Giờ cần lại đúng 2 lần.
		assert.equal(queue.recordCorrect("q1", 4000), false);
		assert.equal(queue.recordCorrect("q1", 5000), true);
	} finally {
		storage.restore();
	}
});

test("trả lời đúng câu KHÔNG có trong queue thì không làm gì", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();
		assert.equal(queue.recordCorrect("khong-co", 1000), false);
		assert.equal(queue.all.length, 0);
	} finally {
		storage.restore();
	}
});

test("queue có trần 30 câu và bỏ mục CŨ NHẤT khi tràn (FIFO)", async function () {
	var storage = installStorage();

	try {
		var module = await loadClientModule("systems/ReviewQueue.ts");
		var queue = new module.ReviewQueue();

		for (var index = 0; index < module.MAX_QUEUE_SIZE + 5; index += 1) {
			queue.recordWrong("q" + index, "lop6", 1000 + index);
		}

		assert.equal(queue.all.length, module.MAX_QUEUE_SIZE, "không được phình quá trần");
		assert.equal(queue.has("q0"), false, "5 câu cũ nhất phải bị đẩy ra");
		assert.equal(queue.has("q4"), false);
		assert.equal(queue.has("q5"), true, "câu mới nhất phải còn");
		assert.equal(queue.has("q34"), true);
	} finally {
		storage.restore();
	}
});

test("queue tách theo lớp — câu lớp 6 không lẫn sang lớp 7", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();

		queue.recordWrong("a1", "lop6", 1000);
		queue.recordWrong("b1", "lop7", 1000);

		assert.equal(queue.forLevel("lop6").length, 1);
		assert.equal(queue.forLevel("lop7").length, 1);
		assert.equal(queue.forLevel("lop8").length, 0);
	} finally {
		storage.restore();
	}
});

test("trộn câu ôn vào CUỐI mảng để được pop ra TRƯỚC (hàng đợi pop từ cuối)", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();
		var allQuestions = [];

		for (var index = 0; index < 10; index += 1) {
			allQuestions.push({ id: "q" + index });
		}

		queue.recordWrong("q3", "lop6", 1000);
		queue.recordWrong("q7", "lop6", 1000);

		var baseQueue = allQuestions.slice();
		var mixed = queue.mixIntoQueue("lop6", baseQueue, allQuestions);

		// Hợp đồng V1: game pop từ CUỐI mảng ⇒ câu ôn phải nằm ở cuối.
		var lastTwo = mixed.slice(-2).map(function (question) { return question.id; });
		assert.deepEqual(lastTwo.sort(), ["q3", "q7"], "câu ôn phải ở CUỐI để ra sớm");

		// Không nhân bản: q3/q7 chỉ xuất hiện đúng 1 lần.
		var ids = mixed.map(function (question) { return question.id; });
		assert.equal(ids.filter(function (id) { return id === "q3"; }).length, 1);
		assert.equal(mixed.length, allQuestions.length);
	} finally {
		storage.restore();
	}
});

test("không có câu ôn thì hàng đợi giữ nguyên", async function () {
	var storage = installStorage();

	try {
		var queue = await freshQueue();
		var allQuestions = [{ id: "q1" }, { id: "q2" }];
		var baseQueue = allQuestions.slice();

		assert.deepEqual(queue.mixIntoQueue("lop6", baseQueue, allQuestions), baseQueue);
	} finally {
		storage.restore();
	}
});

test("queue sống sót qua các ván (ghi xuống localStorage đúng khóa -v2)", async function () {
	var storage = installStorage();

	try {
		var module = await loadClientModule("systems/ReviewQueue.ts");
		var first = new module.ReviewQueue();
		first.recordWrong("q1", "lop6", 1000);

		var keys = Array.from(storage.raw.keys());
		assert.ok(
			keys.indexOf("endlessrunner-review-queue-v2") !== -1,
			"phải ghi đúng khóa hợp đồng, đang có: " + keys.join(", ")
		);

		// Ván sau: dựng lại từ localStorage.
		var second = new module.ReviewQueue();
		assert.equal(second.has("q1"), true, "câu sai phải còn sau khi tải lại trang");
	} finally {
		storage.restore();
	}
});

test("dữ liệu hỏng trong localStorage không làm sập game", async function () {
	var storage = installStorage();

	try {
		storage.raw.set("endlessrunner-review-queue-v2", "{ khong phai json");

		var module = await loadClientModule("systems/ReviewQueue.ts");
		var queue = new module.ReviewQueue();
		assert.deepEqual(queue.all, []);

		storage.raw.set("endlessrunner-review-queue-v2", JSON.stringify({ entries: [{ rác: true }, null, 5] }));
		var second = new module.ReviewQueue();
		assert.deepEqual(second.all, [], "mục không hợp lệ phải bị lọc bỏ");
	} finally {
		storage.restore();
	}
});
