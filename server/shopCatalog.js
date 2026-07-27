"use strict";

// Bảng giá cửa hàng — NGUỒN SỰ THẬT của phía server (P2-3).
//
// Vì sao giá phải nằm ở server: trước P2-3, giá chỉ có trong `unlockRules.ts` /
// `cosmeticRules.ts` của client, nên "mua Barbarian giá 1 xu" chỉ là một dòng sửa
// trong body request. Từ đây, route mua đọc giá TỪ FILE NÀY và bỏ qua mọi con số
// giá client gửi lên.
//
// Ranh giới cố ý giữa hai bên:
//   · server sở hữu thứ món đồ ĐÁNG GIÁ BAO NHIÊU (id, ô, nhãn, giá) — dữ liệu
//     kinh tế, phải kiểm được;
//   · client sở hữu thứ món đồ TRÔNG NHƯ THẾ NÀO (màu tint, emissive, màu đuôi
//     vệt) — dữ liệu dựng hình, server không có việc gì phải biết.
//
// Hai bảng chạy song song thì sớm muộn cũng trôi khỏi nhau. Chống bằng test:
// `test/economy.test.js` so từng id/ô/giá của file này với `unlockRules.ts` +
// `cosmeticRules.ts` và fail CI nếu lệch một con số.
//
// ⚠ Đây KHÔNG phải nơi giữ luật mốc thành tích. Mốc thành tích là tiến trình
// LOCAL-TRUST theo quyết định Q6 (plan §3) — server ghi nhận chứ không thẩm định,
// xem ghi chú `source` trong `server/economyStore.js`.

/** Ô của món đồ. `character` = P1-3, `skin`/`trail` = ngoại hình P2-2. */
var SLOTS = ["character", "skin", "trail"];

/**
 * Bảng giá. Con số phải TRÙNG `client/src/systems/unlockRules.ts` (nhân vật) và
 * `client/src/systems/cosmeticRules.ts` (ngoại hình) — có test khoá.
 *
 * Món giá 0 vẫn nằm trong catalog: client cần biết chúng tồn tại để dựng danh
 * sách "Mặc định", và server cần biết để nhận `slot` hợp lệ khi ghi sở hữu.
 */
var CATALOG = [
	{ id: "mage", slot: "character", label: "Pháp sư", price: 300 },
	{ id: "rogue", slot: "character", label: "Đạo tặc", price: 500 },
	{ id: "barbarian", slot: "character", label: "Chiến binh", price: 800 },

	{ id: "skin-classic", slot: "skin", label: "Nguyên bản", price: 0 },
	{ id: "skin-gold", slot: "skin", label: "Ánh vàng", price: 150 },
	{ id: "skin-shadow", slot: "skin", label: "Bóng đêm", price: 150 },
	{ id: "skin-neon", slot: "skin", label: "Dạ quang", price: 250 },

	{ id: "trail-none", slot: "trail", label: "Không vệt", price: 0 },
	{ id: "trail-spark", slot: "trail", label: "Vệt lửa", price: 120 },
	{ id: "trail-frost", slot: "trail", label: "Vệt băng", price: 120 },
	{ id: "trail-rainbow", slot: "trail", label: "Vệt cầu vồng", price: 250 }
];

function getCatalogItem(itemId) {
	var id = String(itemId == null ? "" : itemId);

	for (var index = 0; index < CATALOG.length; index += 1) {
		if (CATALOG[index].id === id) {
			return CATALOG[index];
		}
	}

	return null;
}

/** Bản sao để người gọi (route JSON) không sửa được bảng gốc trong bộ nhớ. */
function listCatalog() {
	return CATALOG.map(function (item) {
		return { id: item.id, slot: item.slot, label: item.label, price: item.price };
	});
}

module.exports = {
	SLOTS: SLOTS,
	CATALOG: CATALOG,
	listCatalog: listCatalog,
	getCatalogItem: getCatalogItem
};
