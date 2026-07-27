// P2-7 · Kiểm duyệt bảng xếp hạng — port 1:1 từ trang legacy (P1-4).
//
// Cột "Xác minh" là kết quả tự động của server: ✗ nghĩa là điểm nộp không kèm vé
// ván chơi hợp lệ, hoặc vượt trần hợp lý. Đó là DẤU HIỆU ĐỂ XEM LẠI, không phải
// kết luận gian lận — câu chữ trên trang cố ý nói đúng như vậy.

import { adminFetch, deleteJson, postJson } from "@/admin/api";
import { bindDataButtons, escapeHtml, formatDuration, requireElement, requireInput } from "@/admin/dom";
import { reportError, showNotice } from "@/admin/shell";

interface ScoreEntry {
	id: number;
	createdAt: string;
	level: string;
	nickname: string;
	score: number;
	correctCount: number;
	durationMs: number | null;
	verified?: boolean;
}

interface BlockedEntry {
	nickname: string;
	reason?: string | null;
}

function renderScores(entries: ScoreEntry[]): void {
	const tableBody = requireElement("moderation-table-body");

	if (entries.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="8" class="empty">Chưa có điểm nào được nộp.</td></tr>';
		return;
	}

	tableBody.innerHTML = entries
		.map(
			(entry) =>
				"<tr>" +
				`<td class="small">${escapeHtml(new Date(entry.createdAt).toLocaleString("vi-VN"))}</td>` +
				`<td>${escapeHtml(entry.level)}</td>` +
				`<td>${escapeHtml(entry.nickname)}</td>` +
				`<td>${String(entry.score)}</td>` +
				`<td>${String(entry.correctCount)}</td>` +
				`<td>${escapeHtml(formatDuration(entry.durationMs))}</td>` +
				`<td>${entry.verified === true ? "✓" : "✗"}</td>` +
				"<td>" +
				`<button type="button" class="button-secondary" data-block="${escapeHtml(entry.nickname)}">Khoá tên</button> ` +
				`<button type="button" class="button-warning" data-delete-score="${String(entry.id)}">Xoá</button>` +
				"</td>" +
				"</tr>"
		)
		.join("");

	bindDataButtons(tableBody, "data-delete-score", (scoreId) => {
		// Xoá điểm là KHÔNG hoàn tác được — hỏi lại trước khi làm.
		if (window.confirm("Xoá vĩnh viễn bản ghi điểm này?") !== true) {
			return;
		}

		void deleteJson(`/api/admin/scores/${encodeURIComponent(scoreId)}`)
			.then(async () => {
				showNotice("Đã xoá bản ghi điểm.", "success");
				await loadModeration();
			})
			.catch(reportError);
	});

	bindDataButtons(tableBody, "data-block", (nickname) => {
		const input = requireInput("block-nickname");
		input.value = nickname;
		input.focus();
	});
}

function renderBlocked(entries: BlockedEntry[]): void {
	const container = requireElement("blocked-list");

	if (entries.length === 0) {
		container.textContent = "Chưa khoá biệt danh nào.";
		return;
	}

	container.innerHTML = entries
		.map(
			(entry) =>
				'<div style="margin-bottom:6px;">' +
				escapeHtml(entry.nickname) +
				(entry.reason === null || entry.reason === undefined || entry.reason === ""
					? ""
					: ` — ${escapeHtml(entry.reason)}`) +
				` <button type="button" class="button-secondary" data-unblock="${escapeHtml(entry.nickname)}">Bỏ khoá</button>` +
				"</div>"
		)
		.join("");

	bindDataButtons(container, "data-unblock", (nickname) => {
		void deleteJson(`/api/admin/blocked-nicknames/${encodeURIComponent(nickname)}`)
			.then(async () => {
				showNotice("Đã bỏ khoá biệt danh.", "success");
				await loadModeration();
			})
			.catch(reportError);
	});
}

export async function loadModeration(): Promise<void> {
	try {
		const [scores, blocked] = await Promise.all([
			adminFetch<{ entries?: ScoreEntry[] }>("/api/admin/scores?limit=50"),
			adminFetch<{ entries?: BlockedEntry[] }>("/api/admin/blocked-nicknames")
		]);

		renderScores(scores.entries ?? []);
		renderBlocked(blocked.entries ?? []);
	} catch (error) {
		reportError(error);
	}
}

async function blockNickname(): Promise<void> {
	const nickname = requireInput("block-nickname").value.trim();

	if (nickname === "") {
		showNotice("Nhập biệt danh cần khoá.", "error");
		return;
	}

	try {
		const result = await postJson<{ renamed?: number }>("/api/admin/blocked-nicknames", {
			nickname,
			reason: requireInput("block-reason").value.trim() === "" ? null : requireInput("block-reason").value.trim()
		});

		showNotice(
			`Đã khoá "${nickname}"${
				result.renamed !== undefined && result.renamed > 0 ? ` và đổi tên ${String(result.renamed)} bản ghi cũ.` : "."
			}`,
			"success"
		);
		requireInput("block-nickname").value = "";
		requireInput("block-reason").value = "";
		await loadModeration();
	} catch (error) {
		reportError(error);
	}
}

export function bindModerationPanel(): void {
	requireElement("moderation-refresh").addEventListener("click", () => {
		void loadModeration();
	});
	requireElement("block-nickname-button").addEventListener("click", () => {
		void blockNickname();
	});
}
