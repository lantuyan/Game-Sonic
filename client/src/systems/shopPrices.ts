// So bảng giá server với bảng giá dựng sẵn trong client (P2-3) — THUẦN SỐ HỌC.
//
// Vì sao client vẫn giữ bảng giá riêng dù server đã có catalog: game là PWA và
// phải mở được khi mất mạng hoàn toàn. Một cửa hàng trống trơn vì `fetch` hỏng là
// hồi quy so với P1-3/P2-2.
//
// Nhưng hai bảng thì có hai cơ hội sai. Phân vai rõ:
//   · GIÁ THỰC SỰ BỊ TRỪ luôn do server quyết (`server/shopCatalog.js`) — client
//     không có tiếng nói trong chuyện đó;
//   · bảng client chỉ để HIỂN THỊ và để tính nhẩm phía local;
//   · CI khoá hai bảng bằng nhau (`test/economy.test.js`), nên chúng chỉ lệch được
//     trong đúng MỘT tình huống: máy đang chạy bản client cũ trong cache Service
//     Worker trong khi server đã lên bản mới.
//
// Tình huống đó có thật và im lặng: em ấy thấy "300 xu", bấm mua, server trừ 350,
// và không ai hiểu vì sao. Hàm dưới đây là thứ biến nó thành một câu nói được.

export interface CatalogPrice {
	id: string;
	price: number;
}

export interface CatalogMismatch {
	id: string;
	/** Giá client đang hiển thị. null = client không biết món này. */
	localPrice: number | null;
	/** Giá server sẽ trừ. null = server không còn bán món này. */
	serverPrice: number | null;
}

/**
 * Trả về danh sách món lệch giá (hoặc chỉ có ở một bên).
 *
 * Rỗng = hai bảng khớp. Cố ý KHÔNG tự "sửa" giá client theo server: một bảng giá
 * bị ghi đè lúc chạy nghĩa là con số hiển thị và con số dùng để tính nhẩm có thể
 * khác nhau trong cùng một khung hình, và đó là loại lỗi tệ hơn cả cái nó chữa.
 */
export function compareCatalog(
	serverItems: readonly CatalogPrice[],
	localItems: readonly CatalogPrice[]
): CatalogMismatch[] {
	const serverById = new Map(serverItems.map((item) => [item.id, item.price]));
	const localById = new Map(localItems.map((item) => [item.id, item.price]));
	const mismatches: CatalogMismatch[] = [];

	for (const [id, localPrice] of localById) {
		const serverPrice = serverById.get(id);

		if (serverPrice === undefined || serverPrice !== localPrice) {
			mismatches.push({ id, localPrice, serverPrice: serverPrice ?? null });
		}
	}

	for (const [id, serverPrice] of serverById) {
		if (localById.has(id) === false) {
			mismatches.push({ id, localPrice: null, serverPrice });
		}
	}

	return mismatches;
}
