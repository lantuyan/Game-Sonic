// Ổ cắm sổ cái xu (P2-3) — một interface + một biến, không hơn.
//
// Vì sao cần tồn tại: `Unlocks` và `Missions` là hai nơi DUY NHẤT được phép chạm
// ví (kỷ luật một-đường-đi từ P1-3/P1-8), nên chúng cũng phải là nơi báo cho sổ
// cái server. Nhưng cho hai lớp đó `import` thẳng `EconomySync` thì kéo theo cả
// `questionBridge` + `fetch` vào một chỗ đến giờ vẫn thuần logic, và mọi test cũ
// của chúng sẽ phải dựng stub mạng chỉ để mua một cái skin.
//
// Ổ cắm giải đúng chuyện đó: chưa cắm gì (test, kịch bản offline sớm) thì mọi lời
// gọi là no-op và hành vi giống hệt trước P2-3. `App` cắm `EconomySync` vào lúc
// khởi động — đúng một chỗ.

import type { CoinEntryKind, PurchaseSource } from "@/systems/coinOutbox";

export interface CoinLedgerSink {
	record(kind: CoinEntryKind, amount: number, reason?: string): void;
	recordPurchase(itemId: string, paidCoins: number, source: PurchaseSource): void;
}

let sink: CoinLedgerSink | null = null;

export function setCoinLedgerSink(value: CoinLedgerSink | null): void {
	sink = value;
}

export function coinLedger(): CoinLedgerSink | null {
	return sink;
}
