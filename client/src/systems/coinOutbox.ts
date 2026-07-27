// Hộp thư đi của sổ cái xu (P2-3) — THUẦN SỐ HỌC, không fetch, không DOM.
//
// Vì sao phải có hàng đợi thay vì gọi thẳng API lúc xu đổi:
//
// Ví local vẫn là bản làm việc (game phải chơi được khi rớt mạng, và không em nào
// đáng phải chờ một request mới thấy xu vừa nhặt). Nhưng nếu mỗi thay đổi xu chỉ
// là một lời gọi `fetch` "gửi được thì gửi", thì rớt mạng đúng lúc = server thiếu
// vĩnh viễn số xu đó, và về sau server sẽ từ chối một lần mua hoàn toàn hợp lệ.
//
// Hàng đợi giải đúng chuyện đó: bút toán nằm lại trong localStorage tới khi server
// nhận, và được đẩy lại theo ĐÚNG THỨ TỰ ban đầu. "Nhận 150 rồi tiêu 150" replay
// sau ba ngày vẫn thành công, dù lúc bắt đầu số dư trên server là 0.
//
// Ba luật của việc dọn hàng đợi:
//   · server nhận (kể cả nhận từ lần trước — trùng `ref`)  → BỎ khỏi hàng đợi;
//   · server TỪ CHỐI có lý do (không đủ xu / đã sở hữu)    → BỎ, và đếm vào
//     `dropped`. Giữ lại là hàng đợi tắc vĩnh viễn vì một dòng độc;
//   · lỗi mạng / 5xx / server chưa bật CSDL                 → GIỮ NGUYÊN, thử lại sau.

export type CoinEntryKind = "run" | "mission" | "streak" | "revive" | "purchase" | "adjust";

export type PurchaseSource = "coins" | "achievement";

export interface CoinOutboxEntry {
	/** Khoá tự nhiên. Gửi lại cùng `ref` là no-op ở phía server. */
	ref: string;
	kind: CoinEntryKind;
	/** Dương = nhận xu, âm = tiêu xu. Với món mua, đây là số xu đã trừ ở local. */
	amount: number;
	reason?: string;
	/**
	 * Có mặt ⇒ bút toán này đi route `/purchases` (trừ xu + ghi sở hữu nguyên tử)
	 * thay vì `/wallet/entries`. `amount` khi đó chỉ để đọc hiểu — server tự lấy
	 * giá từ catalog của nó.
	 */
	purchase?: {
		itemId: string;
		source: PurchaseSource;
	};
}

export interface CoinOutboxState {
	entries: CoinOutboxEntry[];
	/** Bộ đếm tăng dần để `ref` không trùng nhau trong cùng một mili-giây. */
	sequence: number;
	/** Số bút toán bị server từ chối có lý do — chỉ để chẩn đoán, không dùng để tính xu. */
	dropped: number;
}

export const DEFAULT_OUTBOX: CoinOutboxState = {
	entries: [],
	sequence: 0,
	dropped: 0
};

/**
 * Trần hàng đợi. Chạm trần thì bỏ bút toán CŨ NHẤT.
 *
 * Có trần vì một máy không bao giờ nối được server sẽ tích luỹ vô hạn và cuối cùng
 * làm đầy quota localStorage — lúc đó `saveWallet` cũng ghi hỏng theo, và ta mất
 * đúng thứ đang cố bảo vệ. Bỏ bút toán cũ nhất là mất một dòng LỊCH SỬ trên server;
 * ví local (thứ người chơi thật sự tiêu) không suy suyển.
 */
export const OUTBOX_LIMIT = 200;

/** Số request tối đa cho một lần đẩy — không để một lần đẩy kéo dài vô hạn. */
export const MAX_FLUSH_REQUESTS = 10;

/**
 * Sinh `ref`. Ba thành phần: thời điểm · bộ đếm · nhiễu ngẫu nhiên.
 *
 * Bộ đếm một mình là chưa đủ: nếu localStorage ghi hỏng (hết quota, chế độ riêng
 * tư) thì bộ đếm quay lại giá trị cũ, và hai bút toán KHÁC NHAU sẽ mang cùng `ref`
 * — server nuốt cái thứ hai như bản trùng, và người chơi mất xu thật. Thêm nhiễu
 * làm kịch bản đó biến mất trên thực tế.
 */
export function makeRef(kind: string, nowMs: number, sequence: number, noise: string): string {
	return `${kind}-${nowMs.toString(36)}-${sequence.toString(36)}-${noise}`;
}

export function randomNoise(random: () => number = Math.random): string {
	return Math.floor(random() * 0x10000)
		.toString(36)
		.padStart(4, "0");
}

/** Thêm một bút toán vào cuối hàng đợi. Thuần: trả state mới, không sửa state cũ. */
export function enqueue(state: CoinOutboxState, entry: CoinOutboxEntry): CoinOutboxState {
	const entries = [...state.entries, entry];

	return {
		entries: entries.length > OUTBOX_LIMIT ? entries.slice(entries.length - OUTBOX_LIMIT) : entries,
		sequence: state.sequence + 1,
		dropped: state.dropped
	};
}

/**
 * Lô kế tiếp cần đẩy, lấy từ ĐẦU hàng đợi.
 *
 * Thứ tự là bất khả xâm phạm, nên lô chỉ gom được một tiền tố ĐỒNG LOẠI: hoặc một
 * dãy bút toán thường (một request `/wallet/entries`), hoặc đúng MỘT món mua (một
 * request `/purchases`). Gom lẫn lộn là đảo thứ tự "nhận trước, tiêu sau".
 */
export function nextBatch(
	state: CoinOutboxState
): { kind: "entries"; entries: CoinOutboxEntry[] } | { kind: "purchase"; entry: CoinOutboxEntry } | null {
	const head = state.entries[0];

	if (head === undefined) {
		return null;
	}

	if (head.purchase !== undefined) {
		return { kind: "purchase", entry: head };
	}

	const batch: CoinOutboxEntry[] = [];

	for (const entry of state.entries) {
		if (entry.purchase !== undefined) {
			break;
		}

		batch.push(entry);
	}

	return { kind: "entries", entries: batch };
}

export interface EntryAck {
	ref: string;
	/** Server đã có bút toán này trong sổ (lần này hoặc lần trước). */
	accepted: boolean;
}

/**
 * Áp kết quả một request thành công lên hàng đợi.
 *
 * `refs` là những bút toán đã GỬI. Cái nào server báo nhận thì bỏ; cái nào đã gửi
 * mà server không nhận thì cũng bỏ nhưng tính vào `dropped` — server đã trả lời
 * dứt khoát "không", thử lại cũng chỉ nhận đúng câu đó.
 *
 * Bút toán KHÔNG nằm trong `refs` (đến sau, trong lúc request đang bay) được giữ
 * nguyên — đây là chỗ dễ mất xu nhất nếu ai đó "dọn cho gọn" bằng cách xoá cả
 * hàng đợi sau mỗi lần đẩy thành công.
 */
export function applyAcks(state: CoinOutboxState, acks: readonly EntryAck[]): CoinOutboxState {
	if (acks.length === 0) {
		return state;
	}

	const byRef = new Map(acks.map((ack) => [ack.ref, ack.accepted]));
	let dropped = 0;

	const entries = state.entries.filter((entry) => {
		const ack = byRef.get(entry.ref);

		if (ack === undefined) {
			return true;
		}

		if (ack === false) {
			dropped += 1;
		}

		return false;
	});

	return { entries, sequence: state.sequence, dropped: state.dropped + dropped };
}

/** Tổng xu đang chờ đẩy — dùng để hiển thị/chẩn đoán, KHÔNG dùng để tính số dư. */
export function pendingCoins(state: CoinOutboxState): number {
	return state.entries.reduce((total, entry) => total + entry.amount, 0);
}

/** Chuẩn hoá state đọc từ localStorage (có thể là rác, có thể là bản cũ). */
export function normalizeOutbox(stored: unknown): CoinOutboxState {
	if (stored === null || typeof stored !== "object") {
		return { ...DEFAULT_OUTBOX, entries: [] };
	}

	const value = stored as Partial<CoinOutboxState>;
	const entries = Array.isArray(value.entries) ? value.entries.filter(isValidEntry) : [];

	return {
		entries: entries.length > OUTBOX_LIMIT ? entries.slice(entries.length - OUTBOX_LIMIT) : entries,
		sequence: toCount(value.sequence),
		dropped: toCount(value.dropped)
	};
}

function isValidEntry(entry: unknown): entry is CoinOutboxEntry {
	if (entry === null || typeof entry !== "object") {
		return false;
	}

	const value = entry as Partial<CoinOutboxEntry>;

	return (
		typeof value.ref === "string" &&
		value.ref !== "" &&
		typeof value.kind === "string" &&
		typeof value.amount === "number" &&
		Number.isFinite(value.amount) === true
	);
}

function toCount(value: unknown): number {
	const numericValue = Number(value);
	return Number.isFinite(numericValue) && numericValue > 0 ? Math.floor(numericValue) : 0;
}
