// P2-7 · Nhập / xuất ngân hàng câu hỏi bằng Excel — port 1:1 từ trang legacy (P2-6).
//
// Luồng BẮT BUỘC hai bước: chọn file → **xem trước** → xác nhận. Nút xác nhận chỉ
// mở khi có một bản xem trước hợp lệ, và mọi thay đổi (đổi file, đổi chế độ) đều
// đóng nó lại — thứ được ghi phải đúng bằng thứ đã xem.

import { downloadViaNavigation, postCsv } from "@/admin/api";
import { escapeHtml, requireButton, requireElement, requireInput, requireSelect } from "@/admin/dom";
import { registerBusyResync, setBusy, showNotice } from "@/admin/shell";
import { levelLabel, state } from "@/admin/state";
import { loadCurrentLevelData } from "@/admin/questions";

interface ImportLevelPlan {
	level: string;
	currentCount: number;
	added: string[];
	updated: string[];
	removed: string[];
	resultCount: number;
}

interface ImportPlan {
	ok: true;
	digest: string;
	warnings?: string[];
	totals: { rows: number; added: number; updated: number; removed: number; unchanged: number };
	levels: ImportLevelPlan[];
	untouchedLevels?: string[];
}

interface ImportErrors {
	ok: false;
	error?: string;
	errorCount?: number;
	errors?: Array<{ line: number; excelRow: number; message: string }>;
}

type ImportResponse = ImportPlan | ImportErrors;

const bankImport = {
	csvText: "",
	digest: "",
	mode: "merge" as "merge" | "replace"
};

/**
 * Nút "Xác nhận nhập" mở/khoá THEO `digest`, không theo lượt bấm.
 *
 * Cần hàm riêng vì `setBusy(false)` bật lại MỌI nút trên trang — gọi nó sau một lần
 * xem trước thất bại sẽ mở đường ghi cho một kế hoạch không tồn tại. Mọi nhánh kết
 * thúc đều phải đi qua đây (đã đăng ký với `registerBusyResync`).
 */
function syncApplyButton(): void {
	requireButton("bank-apply-button").disabled = bankImport.digest === "";
}

function lockApply(): void {
	bankImport.digest = "";
	syncApplyButton();
}

function setMessage(html: string): void {
	requireElement("bank-import-result").innerHTML = html;
}

function renderErrors(payload: ImportErrors): void {
	const errors = payload.errors ?? [];
	const parts: string[] = [];

	if (errors.length > 0) {
		parts.push(
			`<p><strong>Không nhập được — file có ${String(payload.errorCount ?? errors.length)} lỗi.</strong> ` +
				"Sửa trong Excel rồi chọn lại file.</p>"
		);
		parts.push(
			'<ul style="margin:0;padding-left:18px;">' +
				errors
					// Hai số dòng vì Excel NUỐT dòng chỉ thị `sep=,` ở đầu file — giáo viên
					// không phải tự trừ đi 1.
					.map(
						(item) =>
							`<li>Dòng ${String(item.line)} trong file (Excel: dòng ${String(item.excelRow)}) — ${escapeHtml(item.message)}</li>`
					)
					.join("") +
				"</ul>"
		);
	}

	if (payload.error !== undefined && payload.error !== "") {
		parts.push(`<p>${escapeHtml(payload.error)}</p>`);
	}

	setMessage(parts.length > 0 ? parts.join("") : "<p>Không nhập được file này.</p>");
}

function renderPlan(plan: ImportPlan): void {
	const parts: string[] = [];

	for (const warning of plan.warnings ?? []) {
		parts.push(`<p><strong>Lưu ý:</strong> ${escapeHtml(warning)}</p>`);
	}

	parts.push(
		`<p><strong>File đọc được ${String(plan.totals.rows)} câu.</strong> ` +
			`Sẽ thêm <strong>${String(plan.totals.added)}</strong>, ` +
			`sửa <strong>${String(plan.totals.updated)}</strong>, ` +
			`xoá <strong>${String(plan.totals.removed)}</strong>, ` +
			`giữ nguyên ${String(plan.totals.unchanged)} câu.</p>`
	);

	parts.push(
		'<div class="table-wrap"><table class="table-compact"><thead><tr>' +
			"<th>Lớp</th><th>Đang có</th><th>Thêm</th><th>Sửa</th><th>Xoá</th><th>Sau khi nhập</th>" +
			"</tr></thead><tbody>" +
			plan.levels
				.map(
					(item) =>
						"<tr>" +
						`<td>${escapeHtml(levelLabel(item.level))}</td>` +
						`<td>${String(item.currentCount)}</td>` +
						`<td>${String(item.added.length)}</td>` +
						`<td>${String(item.updated.length)}</td>` +
						`<td>${String(item.removed.length)}</td>` +
						`<td>${String(item.resultCount)}</td>` +
						"</tr>"
				)
				.join("") +
			"</tbody></table></div>"
	);

	if ((plan.untouchedLevels ?? []).length > 0) {
		parts.push(
			"<p>Không có trong file nên <strong>không bị đụng tới</strong>: " +
				(plan.untouchedLevels ?? []).map((level) => escapeHtml(levelLabel(level))).join(", ") +
				".</p>"
		);
	}

	const removedIds = plan.levels.flatMap((item) => item.removed.map((id) => `${levelLabel(item.level)} · ${id}`));

	if (removedIds.length > 0) {
		// Xoá là KHÔNG hoàn tác được — liệt kê từng mã ra để giáo viên nhìn tận mắt
		// trước khi bấm xác nhận.
		parts.push(
			"<p><strong>Sẽ bị xoá vĩnh viễn:</strong> " +
				escapeHtml(removedIds.slice(0, 40).join(", ")) +
				(removedIds.length > 40 ? ` … và ${String(removedIds.length - 40)} câu nữa` : "") +
				".</p>"
		);
	}

	if (plan.totals.added + plan.totals.updated + plan.totals.removed === 0) {
		parts.push("<p>File giống hệt ngân hàng hiện tại — bấm xác nhận cũng không đổi gì.</p>");
	}

	setMessage(parts.join(""));
}

function handleFileChange(): void {
	lockApply();
	bankImport.csvText = "";

	const file = requireInput("bank-import-file").files?.[0];

	if (file === undefined) {
		setMessage("Chưa chọn file nào.");
		return;
	}

	const reader = new FileReader();

	reader.onerror = (): void => {
		setMessage("Không đọc được file này.");
	};

	reader.onload = (): void => {
		bankImport.csvText = String(reader.result ?? "");
		setMessage(`Đã đọc “${escapeHtml(file.name)}”. Bấm “Xem trước thay đổi” để kiểm tra trước khi ghi.`);
	};

	// Ép UTF-8: BOM trong file ta xuất ra sẽ tự bị bỏ qua, còn file lưu sai bảng mã
	// sẽ lòi ra ký tự thay thế và server chặn ngay ở bước xem trước.
	reader.readAsText(file, "utf-8");
}

async function handlePreview(): Promise<void> {
	if (bankImport.csvText === "") {
		showNotice("Chọn file CSV đã sửa trước đã.", "error");
		return;
	}

	lockApply();
	bankImport.mode = requireSelect("bank-import-mode").value === "replace" ? "replace" : "merge";
	setBusy(true);
	setMessage("Đang kiểm tra file…");

	try {
		const payload = await postCsv<ImportResponse>(
			`/api/admin/questions/import/preview?mode=${bankImport.mode}`,
			bankImport.csvText
		);

		if (payload.ok !== true) {
			renderErrors(payload);
			return;
		}

		bankImport.digest = payload.digest;
		renderPlan(payload);
	} catch (error) {
		setMessage(`<p>${escapeHtml(error instanceof Error ? error.message : "Không nhập được file này.")}</p>`);
	} finally {
		setBusy(false);
	}
}

async function handleApply(): Promise<void> {
	if (bankImport.digest === "") {
		showNotice("Bấm “Xem trước thay đổi” trước khi xác nhận.", "error");
		return;
	}

	if (window.confirm("Ghi thay đổi vào ngân hàng câu hỏi? Thao tác này không hoàn tác được.") !== true) {
		return;
	}

	setBusy(true);

	try {
		const payload = await postCsv<ImportResponse>(
			`/api/admin/questions/import/apply?mode=${bankImport.mode}&digest=${encodeURIComponent(bankImport.digest)}`,
			bankImport.csvText
		);

		if (payload.ok !== true) {
			renderErrors(payload);
			lockApply();
			return;
		}

		lockApply();
		requireInput("bank-import-file").value = "";
		bankImport.csvText = "";
		setMessage("Đã ghi vào ngân hàng. Chọn file khác nếu cần nhập tiếp.");

		// Báo thành công SAU khi nạp lại danh sách: `loadCurrentLevelData` mở đầu bằng
		// `hideNotice()`, nên gọi `showNotice` trước nó thì thông báo biến mất ngay
		// trước mắt người dùng.
		await loadCurrentLevelData();
		showNotice(
			`Đã nhập xong: thêm ${String(payload.totals.added)}, sửa ${String(payload.totals.updated)}, ` +
				`xoá ${String(payload.totals.removed)} câu.`,
			"success"
		);
	} catch (error) {
		setMessage(`<p>${escapeHtml(error instanceof Error ? error.message : "Không nhập được file này.")}</p>`);
		lockApply();
	} finally {
		setBusy(false);
	}
}

export function bindImportExportPanel(): void {
	registerBusyResync(syncApplyButton);

	requireElement("bank-export-all").addEventListener("click", () => {
		downloadViaNavigation("/api/admin/questions.csv");
	});
	requireElement("bank-export-level").addEventListener("click", () => {
		downloadViaNavigation(`/api/admin/questions.csv?level=${encodeURIComponent(state.level)}`);
	});
	requireInput("bank-import-file").addEventListener("change", handleFileChange);
	// Đổi chế độ (giữ / xoá) là đổi kế hoạch ⇒ bản xem trước cũ hết hiệu lực.
	requireSelect("bank-import-mode").addEventListener("change", () => {
		lockApply();
		setMessage("Đã đổi cách xử lý câu thiếu — xem trước lại trước khi nhập.");
	});
	requireElement("bank-preview-button").addEventListener("click", () => {
		void handlePreview();
	});
	requireElement("bank-apply-button").addEventListener("click", () => {
		void handleApply();
	});
}
