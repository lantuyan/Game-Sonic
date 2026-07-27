// Luật bốc câu cho Boss Gate (plan §4.3 mục 3 / §4.6) — THUẦN SỐ HỌC, không three.
//
// Hợp đồng AI: boss bốc câu ở bậc `targetDifficultyIndex + 0.5..1` nhưng KHÔNG BAO
// GIỜ dưới "hard". Nghĩa là học sinh yếu (target = easy) vẫn gặp câu hard ở boss —
// đó là chủ ý: boss là chỗ duy nhất trong ván mà kiến thức ăn vào mạng, nên nó phải
// là một cột mốc thật, không phải câu dễ đội lốt.
//
// ⚠ Bank thật có lớp chỉ toàn easy/medium. Khi bậc mong muốn không có câu nào,
// `pickBossQuestion` HẠ DẦN xuống bậc gần nhất còn câu thay vì trả null — thà hỏi
// câu medium còn hơn nuốt mất cả chặng boss.

import { tuning } from "@/tuning";
import type { SeededRandom } from "@/core/random";
import type { LegacyQuestion } from "@/integration/questionBank.d";

/**
 * Bản sao của `QuestionModel.DIFFICULTY_ORDER` (shared/questionModel.js).
 *
 * Không import được vì file này phải chạy dưới `node --test` không có DOM, còn
 * questionModel.js là script legacy nạp qua <script>. `test/contract.test.js` khóa
 * hai bản này phải khớp từng phần tử — lệch là CI đỏ ngay.
 */
export const DEFAULT_DIFFICULTY_ORDER: readonly string[] = ["easy", "medium", "hard", "expert"];

/**
 * Bậc độ khó cho câu boss: `target + 0.5 .. target + 1`, kẹp sàn ở
 * `tuning.boss.minDifficultyIndex` và trần ở bậc cao nhất có trong bảng.
 */
export function pickBossDifficultyIndex(
	targetDifficultyIndex: number,
	random: SeededRandom,
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): number {
	const safeTarget = Number.isFinite(targetDifficultyIndex) === true ? targetDifficultyIndex : 0;
	// +0.5..+1 rồi làm tròn — cho ra "nhích lên 1 bậc" phần lớn lượt, thỉnh thoảng 2.
	const raised = Math.round(safeTarget + 0.5 + random() * 0.5);
	const ceiling = Math.max(order.length - 1, 0);

	return Math.min(Math.max(raised, tuning.boss.minDifficultyIndex), ceiling);
}

/**
 * Bốc một câu cho boss.
 *   · ưu tiên đúng bậc mong muốn;
 *   · không có thì tìm bậc gần nhất — ƯU TIÊN BẬC CAO HƠN khi hai bên cách đều;
 *   · bỏ qua câu đã dùng trong ván (kể cả ở cổng thường) để không hỏi lại.
 * Trả về null khi không còn câu nào.
 */
export function pickBossQuestion(
	questions: readonly LegacyQuestion[],
	desiredIndex: number,
	random: SeededRandom,
	usedIds: ReadonlySet<string> = new Set(),
	order: readonly string[] = DEFAULT_DIFFICULTY_ORDER
): LegacyQuestion | null {
	const pool = questions.filter((question) => usedIds.has(question.id) === false);

	if (pool.length === 0) {
		return null;
	}

	const byIndex = new Map<number, LegacyQuestion[]>();

	for (const question of pool) {
		// Câu có difficulty lạ (bank cũ dùng "general") xếp về bậc 0 thay vì bỏ đi.
		const index = Math.max(order.indexOf(question.difficulty), 0);
		const bucket = byIndex.get(index);

		if (bucket === undefined) {
			byIndex.set(index, [question]);
			continue;
		}

		bucket.push(question);
	}

	const candidates = [...byIndex.keys()].sort((a, b) => {
		const distance = Math.abs(a - desiredIndex) - Math.abs(b - desiredIndex);
		// Cách đều → chọn bậc CAO hơn (boss không được dễ đi).
		return distance !== 0 ? distance : b - a;
	});

	const bestIndex = candidates[0];

	if (bestIndex === undefined) {
		return null;
	}

	const bucket = byIndex.get(bestIndex) ?? [];
	return bucket[Math.floor(random() * bucket.length)] ?? null;
}

/**
 * Thời lượng trả lời của boss: lấy `question.time` của bank nhưng kẹp vào dải riêng.
 * Đề expert của giáo viên hay đặt 60s — đứng im 1 phút giữa ván là hỏng nhịp chạy.
 */
export function computeBossQuestionSec(question: LegacyQuestion): number {
	const raw = Number.isFinite(question.time) === true ? question.time : tuning.boss.questionMaxSec;
	return Math.min(Math.max(raw, tuning.boss.questionMinSec), tuning.boss.questionMaxSec);
}
