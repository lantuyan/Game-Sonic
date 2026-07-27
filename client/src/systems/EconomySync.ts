// Cầu nối ví local ↔ nền kinh tế server (P2-3).
//
// NƠI DUY NHẤT phía client gọi các route kinh tế. Luật thuần nằm ở
// `systems/coinOutbox.ts`; file này chỉ lo mạng, localStorage và thứ tự.
//
// ĐỌC KỸ TRƯỚC KHI SỬA — đây là mã động vào tiền của người chơi:
//
//   1. **Ví local KHÔNG BAO GIỜ bị xoá hay ghi đè bởi file này.** Không có một
//      lời gọi `saveWallet` nào ở đây ngoài việc bật cờ `migratedToServer` SAU khi
//      server đã xác nhận nhận được. Đồng bộ hai chiều (kéo số dư server đè lên
//      local) cố ý KHÔNG làm: một lần đọc trúng bản sao cũ là cả tuần cày xu của
//      một em biến mất, mà lợi ích (đổi máy vẫn còn xu) thì P2-3 chưa yêu cầu.
//      Task ghi rõ "di trú MỘT CHIỀU local → server".
//
//   2. **Mọi lỗi đều nuốt im lặng.** Người chơi không có gì để làm với "đẩy sổ cái
//      thất bại", và ván chơi không được dừng lại vì chuyện đó. Bút toán nằm lại
//      trong hàng đợi, lần sau đẩy tiếp.
//
//   3. **Bút toán được ghi vào hàng đợi TRƯỚC khi gửi**, và ghi đồng bộ xuống
//      localStorage. Đóng tab ngay sau khi mua thì bút toán vẫn còn đó.

import { readJson, writeJson, loadWallet, saveWallet } from "@/core/SaveData";
import { V2_STORAGE_KEYS } from "@/core/storageKeys";
import {
	applyAcks,
	enqueue,
	makeRef,
	nextBatch,
	normalizeOutbox,
	randomNoise,
	DEFAULT_OUTBOX,
	MAX_FLUSH_REQUESTS,
	type CoinEntryKind,
	type CoinOutboxEntry,
	type CoinOutboxState,
	type EntryAck,
	type PurchaseSource
} from "@/systems/coinOutbox";
import { getDeviceId } from "@/integration/questionBridge";

export interface EntriesResponse {
	results?: { ref: string; accepted: boolean; reason?: string | null }[];
	coins?: number;
	disabled?: boolean;
}

export interface PurchaseResponse {
	ok?: boolean;
	reason?: string;
	coins?: number;
	disabled?: boolean;
}

export interface MigrateResponse {
	migrated?: boolean;
	applied?: boolean;
	coins?: number;
	disabled?: boolean;
}

export interface CatalogItem {
	id: string;
	slot: string;
	label: string;
	price: number;
}

/** Lớp mạng, tách ra để test bơm được kịch bản rớt mạng mà không cần server thật. */
export interface EconomyTransport {
	migrate(deviceId: string, body: { coins: number; items: string[] }): Promise<MigrateResponse>;
	sendEntries(deviceId: string, entries: readonly CoinOutboxEntry[]): Promise<EntriesResponse>;
	sendPurchase(deviceId: string, entry: CoinOutboxEntry): Promise<PurchaseResponse>;
	getCatalog(): Promise<CatalogItem[]>;
}

async function postJson<Result>(url: string, body: unknown): Promise<Result> {
	const response = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		credentials: "same-origin",
		body: JSON.stringify(body)
	});

	// Ném khi HTTP lỗi để `flush` GIỮ LẠI hàng đợi. Coi 5xx/429 là "chưa gửi được"
	// chứ không phải "server đã từ chối" là điểm mấu chốt: server bận một phút
	// không được biến thành mất xu vĩnh viễn.
	if (response.ok === false) {
		throw new Error(`HTTP ${response.status}`);
	}

	return (await response.json()) as Result;
}

export function createFetchTransport(): EconomyTransport {
	const base = (deviceId: string): string => `/api/players/${encodeURIComponent(deviceId)}`;

	return {
		migrate: (deviceId, body) => postJson<MigrateResponse>(`${base(deviceId)}/wallet/migrate`, body),
		sendEntries: (deviceId, entries) =>
			postJson<EntriesResponse>(`${base(deviceId)}/wallet/entries`, {
				entries: entries.map((entry) => ({
					ref: entry.ref,
					kind: entry.kind,
					amount: entry.amount,
					reason: entry.reason
				}))
			}),
		sendPurchase: (deviceId, entry) =>
			postJson<PurchaseResponse>(`${base(deviceId)}/purchases`, {
				ref: entry.ref,
				itemId: entry.purchase?.itemId,
				source: entry.purchase?.source ?? "coins"
			}),
		getCatalog: async () => {
			const response = await fetch("/api/shop/catalog", { credentials: "same-origin" });

			if (response.ok === false) {
				throw new Error(`HTTP ${response.status}`);
			}

			const data = (await response.json()) as { items?: CatalogItem[] };
			return Array.isArray(data.items) ? data.items : [];
		}
	};
}

export interface EconomySyncOptions {
	transport?: EconomyTransport;
	resolveDeviceId?: () => Promise<string | null>;
	now?: () => number;
	random?: () => number;
}

export class EconomySync {
	private state: CoinOutboxState;
	private readonly transport: EconomyTransport;
	private readonly resolveDeviceId: () => Promise<string | null>;
	private readonly now: () => number;
	private readonly random: () => number;

	/** Đang có một lần đẩy chạy — không cho lần thứ hai chen vào giữa. */
	private flushing = false;
	/**
	 * Server trả `disabled: true` (chưa nối Neon). Dừng đẩy trong phiên này thay vì
	 * gọi liên tục cho một tính năng chưa bật. Phiên sau thử lại từ đầu.
	 */
	private serverDisabled = false;

	constructor(options: EconomySyncOptions = {}) {
		this.transport = options.transport ?? createFetchTransport();
		this.resolveDeviceId = options.resolveDeviceId ?? getDeviceId;
		this.now = options.now ?? (() => Date.now());
		this.random = options.random ?? Math.random;
		this.state = normalizeOutbox(readJson<CoinOutboxState>(V2_STORAGE_KEYS.coinOutbox, DEFAULT_OUTBOX));
	}

	get pending(): readonly CoinOutboxEntry[] {
		return this.state.entries;
	}

	get droppedCount(): number {
		return this.state.dropped;
	}

	/** Đọc lại hàng đợi từ localStorage (tab khác vừa ghi). */
	reload(): void {
		this.state = normalizeOutbox(readJson<CoinOutboxState>(V2_STORAGE_KEYS.coinOutbox, DEFAULT_OUTBOX));
	}

	/**
	 * Ghi một thay đổi xu vào hàng đợi. Gọi NGAY SAU khi ví local đã đổi, trong
	 * cùng lời gọi — để không có nhánh nào đổi ví mà quên ghi sổ.
	 */
	record(kind: CoinEntryKind, amount: number, reason?: string): void {
		if (amount === 0) {
			return;
		}

		this.push({ ref: this.nextRef(kind), kind, amount, reason });
	}

	/** Ghi một lần mua. Đi route riêng vì trừ xu và ghi sở hữu phải nguyên tử. */
	recordPurchase(itemId: string, paidCoins: number, source: PurchaseSource): void {
		this.push({
			ref: this.nextRef("purchase"),
			kind: "purchase",
			amount: -Math.abs(paidCoins),
			purchase: { itemId, source }
		});
	}

	private push(entry: CoinOutboxEntry): void {
		this.state = enqueue(this.state, entry);
		this.persist();
		// Đẩy ngay nhưng KHÔNG chờ: người chơi không phải đợi mạng để thấy xu đổi.
		void this.flush();
	}

	private nextRef(kind: string): string {
		return makeRef(kind, this.now(), this.state.sequence, randomNoise(this.random));
	}

	private persist(): void {
		writeJson(V2_STORAGE_KEYS.coinOutbox, this.state);
	}

	/**
	 * Khởi động: di trú ví local lên server (một lần), rồi đẩy hàng đợi.
	 *
	 * Gọi được nhiều lần vô hại — cả cờ local lẫn khoá tự nhiên phía server đều
	 * chặn nhân đôi, và hai lớp đó độc lập nhau.
	 */
	async start(ownedItemIds: readonly string[] = []): Promise<void> {
		await this.migrateOnce(ownedItemIds);
		await this.flush();
	}

	private async migrateOnce(ownedItemIds: readonly string[]): Promise<void> {
		const wallet = loadWallet();

		if (wallet.migratedToServer === true || this.serverDisabled === true) {
			return;
		}

		const deviceId = await this.resolveDeviceId();

		if (deviceId === null) {
			return;
		}

		try {
			const result = await this.transport.migrate(deviceId, {
				coins: Math.max(Math.floor(wallet.coins), 0),
				items: [...ownedItemIds]
			});

			if (result.disabled === true) {
				this.serverDisabled = true;
				return;
			}

			// CHỈ đặt cờ khi server nói đã có bút toán di trú trong sổ. Thất bại giữa
			// chừng (mạng đứt, 5xx) thì cờ không bật và lần sau di trú lại — khoá tự
			// nhiên phía server lo phần không nhân đôi.
			if (result.migrated === true) {
				// Đọc lại ví ngay trước khi ghi: giữa lúc request đang bay, người chơi có
				// thể đã kết thúc một ván và ví đã tăng. Ghi đè bằng bản chụp cũ ở đây
				// chính là cách làm bốc hơi xu mà cả file này sinh ra để tránh.
				saveWallet({ ...loadWallet(), migratedToServer: true });
			}
		} catch {
			// Giữ nguyên mọi thứ, thử lại phiên sau.
		}
	}

	/** Đẩy hàng đợi theo đúng thứ tự. Dừng ngay khi có một request thất bại. */
	async flush(): Promise<void> {
		if (this.flushing === true || this.serverDisabled === true || this.state.entries.length === 0) {
			return;
		}

		const deviceId = await this.resolveDeviceId();

		if (deviceId === null) {
			return;
		}

		this.flushing = true;

		try {
			for (let request = 0; request < MAX_FLUSH_REQUESTS; request += 1) {
				const batch = nextBatch(this.state);

				if (batch === null) {
					break;
				}

				const acks =
					batch.kind === "entries"
						? await this.sendEntries(deviceId, batch.entries)
						: await this.sendPurchase(deviceId, batch.entry);

				if (acks === null) {
					// `disabled` — dừng hẳn, hàng đợi giữ nguyên cho phiên sau.
					break;
				}

				this.state = applyAcks(this.state, acks);
				this.persist();
			}
		} catch {
			// Lỗi mạng/5xx: hàng đợi giữ nguyên phần chưa được xác nhận.
		} finally {
			this.flushing = false;
		}
	}

	/** null = server chưa bật; ngược lại là danh sách xác nhận từng bút toán. */
	private async sendEntries(deviceId: string, entries: readonly CoinOutboxEntry[]): Promise<EntryAck[] | null> {
		const response = await this.transport.sendEntries(deviceId, entries);

		if (response.disabled === true) {
			this.serverDisabled = true;
			return null;
		}

		const byRef = new Map((response.results ?? []).map((result) => [result.ref, result.accepted === true]));

		// Bút toán đã gửi mà server không nhắc tới: coi như CHƯA nhận và giữ lại.
		// Suy đoán "chắc là xong" ở đây là suy đoán theo hướng mất dữ liệu.
		return entries
			.filter((entry) => byRef.has(entry.ref) === true)
			.map((entry) => ({ ref: entry.ref, accepted: byRef.get(entry.ref) === true }));
	}

	private async sendPurchase(deviceId: string, entry: CoinOutboxEntry): Promise<EntryAck[] | null> {
		const response = await this.transport.sendPurchase(deviceId, entry);

		if (response.disabled === true) {
			this.serverDisabled = true;
			return null;
		}

		// "Đã sở hữu" là một câu trả lời THÀNH CÔNG với hàng đợi: server đã có món
		// đó, không còn gì để gửi. Chỉ "không đủ xu" mới là từ chối thật.
		const accepted = response.ok === true || response.reason === "already-owned";

		return [{ ref: entry.ref, accepted }];
	}

	/** Bảng giá từ server. Lỗi mạng → null, phía gọi dùng bảng giá dựng sẵn của client. */
	async fetchCatalog(): Promise<CatalogItem[] | null> {
		try {
			return await this.transport.getCatalog();
		} catch {
			return null;
		}
	}
}
