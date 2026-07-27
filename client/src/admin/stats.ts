// P2-7 · Thống kê lớp học (S17) — port 1:1 từ trang legacy (P1-6 + lọc lớp P2-5).
//
// Biểu đồ thanh THUẦN CSS, không thư viện chart: một thư viện là ~80KB cho ba biểu
// đồ cột — không đáng, và trang này là entry point riêng nên mỗi KB đều là KB giáo
// viên phải tải ở đường truyền của trường.

import { adminFetch, downloadViaNavigation } from "@/admin/api";
import { escapeHtml, requireElement, requireInput, requireSelect } from "@/admin/dom";
import { reportError } from "@/admin/shell";
import { state } from "@/admin/state";

interface StatsPayload {
	totals: { answers: number; correct: number; devices: number };
	runsByDay: Array<{ day: string; runs: number }>;
	accuracyByDifficulty: Array<{ key: string; total: number; accuracy: number }>;
	skillDistribution: Array<{ bucket: number; players: number }>;
	topWrongQuestions: Array<{ questionId: string; level: string; total: number; wrong: number; wrongRate: number }>;
}

interface ChartRow {
	label: string;
	ratio: number;
	display: string;
}

/** Chuỗi truy vấn dùng chung cho cả `stats` và `stats.csv` — hai nơi phải khớp. */
function statsQuery(): string {
	const params = new URLSearchParams();
	params.set("level", state.level);

	// P2-5 — lọc theo lớp thật. Rỗng = gộp toàn trường (hành vi cũ của P1-6).
	const classId = requireSelect("stats-class").value;

	if (classId !== "") {
		params.set("classId", classId);
	}

	const from = requireInput("stats-from").value;
	const to = requireInput("stats-to").value;

	if (from !== "") {
		params.set("from", from);
	}

	if (to !== "") {
		params.set("to", to);
	}

	return params.toString();
}

function renderBarChart(containerId: string, rows: ChartRow[], lowThreshold?: number): void {
	const container = requireElement(containerId);

	if (rows.length === 0) {
		container.innerHTML = '<p class="chart-empty">Chưa có dữ liệu trong khoảng này.</p>';
		return;
	}

	container.innerHTML = rows
		.map((row) => {
			const percent = Math.round(Math.max(Math.min(row.ratio, 1), 0) * 100);
			const lowClass = lowThreshold !== undefined && row.ratio < lowThreshold ? " is-low" : "";

			return (
				'<div class="chart-row">' +
				`<span class="chart-label">${escapeHtml(row.label)}</span>` +
				`<span class="chart-track"><span class="chart-bar${lowClass}" style="width:${String(percent)}%"></span></span>` +
				`<span class="chart-value">${escapeHtml(row.display)}</span>` +
				"</div>"
			);
		})
		.join("");
}

function renderStats(stats: StatsPayload): void {
	const accuracy = stats.totals.answers > 0 ? stats.totals.correct / stats.totals.answers : 0;

	requireElement("stats-summary").innerHTML =
		`<div class="kpi"><span class="kpi-label">Câu đã trả lời</span><span class="kpi-value">${String(stats.totals.answers)}</span></div>` +
		`<div class="kpi"><span class="kpi-label">Tỉ lệ đúng</span><span class="kpi-value">${String(Math.round(accuracy * 100))}%</span></div>` +
		`<div class="kpi"><span class="kpi-label">Số máy đã chơi</span><span class="kpi-value">${String(stats.totals.devices)}</span></div>`;

	const maxRuns = stats.runsByDay.reduce((best, row) => Math.max(best, row.runs), 0);

	renderBarChart(
		"stats-runs-chart",
		stats.runsByDay.map((row) => ({
			label: row.day,
			ratio: maxRuns > 0 ? row.runs / maxRuns : 0,
			display: `${String(row.runs)} ván`
		}))
	);

	// Dưới 50% đúng thì thanh chuyển đỏ — đó là chỗ giáo viên cần dạy lại.
	renderBarChart(
		"stats-difficulty-chart",
		stats.accuracyByDifficulty.map((row) => ({
			label: `${row.key} (${String(row.total)} lượt)`,
			ratio: row.accuracy,
			display: `${String(Math.round(row.accuracy * 100))}%`
		})),
		0.5
	);

	const maxPlayers = stats.skillDistribution.reduce((best, row) => Math.max(best, row.players), 0);
	const bucketLabels = ["0–20%", "20–40%", "40–60%", "60–80%", "80–100%"];

	renderBarChart(
		"stats-skill-chart",
		stats.skillDistribution.map((row) => ({
			label: bucketLabels[Math.min(Math.max(row.bucket, 1), 5) - 1] ?? "",
			ratio: maxPlayers > 0 ? row.players / maxPlayers : 0,
			display: `${String(row.players)} em`
		}))
	);

	const wrongBody = requireElement("stats-wrong-body");

	if (stats.topWrongQuestions.length === 0) {
		wrongBody.innerHTML = '<tr><td colspan="5" class="empty">Chưa đủ dữ liệu (cần ít nhất 3 lượt/câu).</td></tr>';
		return;
	}

	wrongBody.innerHTML = stats.topWrongQuestions
		.map(
			(row) =>
				"<tr>" +
				`<td>${escapeHtml(row.questionId)}</td>` +
				`<td>${escapeHtml(row.level)}</td>` +
				`<td>${String(row.total)}</td>` +
				`<td>${String(row.wrong)}</td>` +
				`<td>${String(Math.round(row.wrongRate * 100))}%</td>` +
				"</tr>"
		)
		.join("");
}

export async function loadStats(): Promise<void> {
	try {
		renderStats(await adminFetch<StatsPayload>(`/api/admin/stats?${statsQuery()}`));
	} catch (error) {
		reportError(error);
	}
}

export function bindStatsPanel(): void {
	requireElement("stats-refresh").addEventListener("click", () => {
		void loadStats();
	});
	requireElement("stats-csv").addEventListener("click", () => {
		downloadViaNavigation(`/api/admin/stats.csv?${statsQuery()}`);
	});
	requireSelect("stats-class").addEventListener("change", () => {
		void loadStats();
	});
}
