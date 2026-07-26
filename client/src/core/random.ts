// PRNG có seed (mulberry32).
//
// Vì sao không dùng Math.random: bố cục trang trí, thứ tự pattern và vị trí coin
// phải TÁI LẬP ĐƯỢC — cùng seed thì cùng ván. Nhờ vậy lỗi "pattern chết chắc"
// báo về kèm seed là dựng lại được y hệt, và unit test của validator chạy tất định.

export type SeededRandom = () => number;

export function createSeededRandom(seed: number): SeededRandom {
	let state = seed >>> 0;

	return function next(): number {
		state = (state + 0x6d2b79f5) >>> 0;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

/** Số thực trong [min, max). */
export function randomRange(random: SeededRandom, min: number, max: number): number {
	return min + random() * (max - min);
}

/** Số nguyên trong [min, max] (bao gồm 2 đầu). */
export function randomInt(random: SeededRandom, min: number, max: number): number {
	return Math.floor(min + random() * (max - min + 1));
}

/** Chọn 1 phần tử. Trả về undefined khi mảng rỗng (an toàn với noUncheckedIndexedAccess). */
export function randomPick<Item>(random: SeededRandom, items: readonly Item[]): Item | undefined {
	if (items.length === 0) {
		return undefined;
	}

	return items[Math.floor(random() * items.length)];
}

/** Trộn tại chỗ (Fisher–Yates) bằng PRNG có seed. */
export function shuffleInPlace<Item>(random: SeededRandom, items: Item[]): Item[] {
	for (let index = items.length - 1; index > 0; index -= 1) {
		const swapIndex = Math.floor(random() * (index + 1));
		const current = items[index];
		const other = items[swapIndex];

		if (current === undefined || other === undefined) {
			continue;
		}

		items[index] = other;
		items[swapIndex] = current;
	}

	return items;
}
