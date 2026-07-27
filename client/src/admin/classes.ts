// P2-7 · Lớp học & mã lớp — port 1:1 từ trang legacy (P2-5).
//
// Ba điều cần nhớ khi sửa phần này (giữ nguyên lời cảnh báo của P2-5):
//   · Mã lớp chỉ mở cửa GHI (gắn máy vào lớp). Không có route nào cho phép người
//     biết mã đọc số liệu — mọi đường đọc đều sau đăng nhập admin.
//   · Danh sách máy trong lớp là chỗ NHẠY CẢM NHẤT của cả trang: nó là nơi duy nhất
//     biệt danh của một em gắn với một lớp cụ thể. Cố ý KHÔNG hiện điểm số hay tỉ lệ
//     đúng của từng em (docs/v2/P2-5-PRIVACY.md §3).
//   · Mã hiển thị đầy đủ vì giáo viên phải chép nó lên bảng; bù lại nó có hạn dùng
//     bắt buộc và thu hồi được ngay.

import { adminFetch, deleteJson, postJson } from "@/admin/api";
import { bindDataButtons, escapeHtml, formatDate, requireElement, requireInput, requireSelect } from "@/admin/dom";
import { reportError, showNotice } from "@/admin/shell";

export interface ClassRow {
	id: number;
	label: string;
	codeDisplay: string;
	level: string | null;
	expiresAt: string;
	status: "active" | "revoked" | "expired";
	memberCount: number;
}

interface ClassMember {
	deviceId: string;
	nickname: string | null;
	joinedAt: string;
}

/** Panel Thống kê đăng ký ở đây để nạp lại số sau khi một máy bị gỡ khỏi lớp. */
type StatsReloader = () => Promise<void>;

let reloadStats: StatsReloader = async () => {
	/* Panel thống kê chưa gắn — không có gì để nạp lại. */
};

export function setStatsReloader(reloader: StatsReloader): void {
	reloadStats = reloader;
}

function statusLabel(status: string): string {
	if (status === "revoked") {
		return "Đã thu hồi";
	}

	if (status === "expired") {
		return "Hết hạn";
	}

	return "Đang dùng";
}

/** Ô chọn lớp của dashboard. Giữ nguyên lựa chọn hiện tại nếu lớp còn tồn tại. */
function renderClassFilterOptions(classes: ClassRow[]): void {
	const select = requireSelect("stats-class");
	const current = select.value;

	select.innerHTML =
		'<option value="">Tất cả (toàn trường)</option>' +
		classes
			.map(
				(row) =>
					`<option value="${String(row.id)}">${escapeHtml(row.label)}` +
					`${row.status === "active" ? "" : ` (${statusLabel(row.status)})`}</option>`
			)
			.join("");

	select.value = current;

	if (select.value !== current) {
		select.value = "";
	}
}

function renderClasses(classes: ClassRow[]): void {
	const tableBody = requireElement("class-table-body");

	if (classes.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="7" class="empty">Chưa có lớp nào. Tạo mã đầu tiên ở trên.</td></tr>';
	} else {
		tableBody.innerHTML = classes
			.map(
				(row) =>
					"<tr>" +
					`<td>${escapeHtml(row.label)}</td>` +
					`<td><strong>${escapeHtml(row.codeDisplay)}</strong></td>` +
					`<td>${escapeHtml(row.level ?? "—")}</td>` +
					`<td class="small">${escapeHtml(formatDate(row.expiresAt))}</td>` +
					`<td>${escapeHtml(statusLabel(row.status))}</td>` +
					`<td>${String(row.memberCount)}</td>` +
					"<td>" +
					`<button type="button" class="button-secondary" data-class-members="${String(row.id)}">Xem máy</button> ` +
					(row.status === "revoked"
						? ""
						: `<button type="button" class="button-warning" data-class-revoke="${String(row.id)}">Thu hồi</button> `) +
					`<button type="button" class="button-warning" data-class-delete="${String(row.id)}">Xoá lớp</button>` +
					"</td>" +
					"</tr>"
			)
			.join("");

		bindDataButtons(tableBody, "data-class-members", (classId) => {
			void loadClassMembers(classId);
		});

		bindDataButtons(tableBody, "data-class-revoke", (classId) => {
			if (window.confirm("Thu hồi mã này? Máy đang trong lớp vẫn ở lại, chỉ không ai vào thêm được nữa.") !== true) {
				return;
			}

			void postJson(`/api/admin/classes/${encodeURIComponent(classId)}/revoke`, {})
				.then(async () => {
					showNotice("Đã thu hồi mã lớp. Tạo mã mới rồi đọc lại cho lớp nhé.", "success");
					await loadClasses();
				})
				.catch(reportError);
		});

		bindDataButtons(tableBody, "data-class-delete", (classId) => {
			// Xoá lớp KHÔNG xoá dữ liệu học tập — nói rõ điều đó ngay trong câu hỏi,
			// vì "xoá" là từ làm người ta sợ đúng chỗ không cần sợ.
			if (
				window.confirm(
					"Xoá lớp này? Số liệu các em đã học vẫn còn trong thống kê toàn trường, chỉ mất liên kết tới lớp."
				) !== true
			) {
				return;
			}

			void deleteJson(`/api/admin/classes/${encodeURIComponent(classId)}`)
				.then(async () => {
					showNotice("Đã xoá lớp. Dữ liệu học tập của các em trở lại trạng thái không gắn lớp.", "success");
					requireElement("class-members").textContent =
						"Bấm “Xem máy” ở một lớp để xem những máy đang thuộc lớp đó.";
					await loadClasses();
				})
				.catch(reportError);
		});
	}

	renderClassFilterOptions(classes);
}

export async function loadClasses(): Promise<void> {
	try {
		const payload = await adminFetch<{ classes?: ClassRow[] }>("/api/admin/classes");
		renderClasses(payload.classes ?? []);
	} catch (error) {
		reportError(error);
	}
}

async function loadClassMembers(classId: string): Promise<void> {
	try {
		const payload = await adminFetch<{ members?: ClassMember[] }>(
			`/api/admin/classes/${encodeURIComponent(classId)}/members`
		);
		const container = requireElement("class-members");
		const members = payload.members ?? [];

		if (members.length === 0) {
			container.textContent = "Lớp này chưa có máy nào vào.";
			return;
		}

		container.innerHTML =
			`<p style="margin:0 0 8px;">Máy đang trong lớp (${String(members.length)}):</p>` +
			'<ul style="margin:0;padding-left:18px;">' +
			members
				.map(
					(member) =>
						"<li>" +
						escapeHtml(member.nickname === null || member.nickname === "" ? "(chưa đặt biệt danh)" : member.nickname) +
						` <span class="muted">· máy ${escapeHtml(String(member.deviceId).slice(0, 8))}…` +
						` · vào lớp ${escapeHtml(formatDate(member.joinedAt))}</span> ` +
						`<button type="button" class="button-secondary" data-remove-member="${escapeHtml(member.deviceId)}">Gỡ khỏi lớp</button>` +
						"</li>"
				)
				.join("") +
			"</ul>";

		bindDataButtons(container, "data-remove-member", (deviceId) => {
			if (
				window.confirm(
					"Gỡ máy này khỏi lớp? Phần dữ liệu máy đó đã ghi cho lớp cũng được gỡ khỏi thống kê của lớp."
				) !== true
			) {
				return;
			}

			void deleteJson(
				`/api/admin/classes/${encodeURIComponent(classId)}/members/${encodeURIComponent(deviceId)}`
			)
				.then(async () => {
					showNotice("Đã gỡ máy khỏi lớp.", "success");
					await Promise.all([loadClasses(), loadClassMembers(classId), reloadStats()]);
				})
				.catch(reportError);
		});
	} catch (error) {
		reportError(error);
	}
}

async function createClass(): Promise<void> {
	const label = requireInput("class-label").value.trim();

	if (label === "") {
		showNotice("Thầy cô đặt tên lớp trước nhé.", "error");
		return;
	}

	try {
		const result = await postJson<{ class: ClassRow }>("/api/admin/classes", {
			label,
			level: requireSelect("class-level").value === "" ? null : requireSelect("class-level").value,
			expiresInDays: Number(requireInput("class-expires").value)
		});

		showNotice(`Đã tạo lớp “${label}” — mã lớp: ${result.class.codeDisplay}`, "success");
		requireInput("class-label").value = "";
		await loadClasses();
	} catch (error) {
		reportError(error);
	}
}

export function bindClassPanel(): void {
	requireElement("class-refresh").addEventListener("click", () => {
		void loadClasses();
	});
	requireElement("class-create-button").addEventListener("click", () => {
		void createClass();
	});
}
