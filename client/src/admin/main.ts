// P2-7 · Bootstrap trang quản trị.
//
// Thay cho khối `<script>` 1.500 dòng của `admin.html` legacy. File này chỉ điều
// phối: kiểm phiên → mở trang → gắn các panel → nạp dữ liệu lần đầu. Mọi logic nằm
// trong `@/admin/*`.
//
// KHÔNG import three.js, không import scene nào của game: trang quản trị là entry
// point RIÊNG (`client/vite.config.mts` → rollupOptions.input.admin), và ngân sách
// 10MB của lần tải đầu là ngân sách của HỌC SINH, không phải chỗ để tiện tay ghép chung.

import "@/admin/admin.css";

import { getAdminConstants } from "@/integration/questionBridge";
import { requestJson } from "@/admin/api";
import { escapeHtml, requireElement, requireInput } from "@/admin/dom";
import { hideNotice, reportError, showNotice } from "@/admin/shell";
import { state } from "@/admin/state";
import { bindQuestionPanels, loadCurrentLevelData, onLevelDataReloaded, resetQuestionForm } from "@/admin/questions";
import { bindImportExportPanel } from "@/admin/importExport";
import { bindClassPanel, loadClasses, setStatsReloader } from "@/admin/classes";
import { bindStatsPanel, loadStats } from "@/admin/stats";
import { bindModerationPanel, loadModeration } from "@/admin/moderation";
import { applyIdentityToUsersPanel, bindUsersPanel, loadUsers } from "@/admin/users";

interface SessionPayload {
	authenticated: boolean;
	username?: string | null;
	role?: string | null;
	multiAccount?: boolean;
}

let initialized = false;

function showAuthShell(): void {
	requireElement("admin-auth-shell").classList.remove("hidden");
	requireElement("admin-page").classList.add("hidden");
}

function showAuthError(message: string): void {
	requireElement("admin-auth-error").textContent = message;
}

function applyIdentity(payload: SessionPayload): void {
	state.identity = {
		username: payload.username ?? "admin",
		role: payload.role === "teacher" ? "teacher" : "owner",
		multiAccount: payload.multiAccount === true
	};

	requireElement("admin-identity").textContent = `${state.identity.username} · ${
		state.identity.role === "owner" ? "quản trị chính" : "giáo viên"
	}`;
	applyIdentityToUsersPanel();
}

async function initializeAdminPage(): Promise<void> {
	if (initialized === true) {
		return;
	}

	initialized = true;

	// Hằng số (danh sách lớp, khoá đáp án, bậc độ khó, dải tốc độ) lấy từ
	// `questionBank.js` qua bridge — KHÔNG chép cứng vào TS: chép cứng là ngày nào
	// đó hai bên lệch nhau mà không ai biết.
	state.constants = await getAdminConstants();

	bindQuestionPanels();
	bindImportExportPanel();
	bindClassPanel();
	bindStatsPanel();
	bindModerationPanel();
	bindUsersPanel();
	setStatsReloader(loadStats);

	resetQuestionForm();
	await loadCurrentLevelData();
	void loadModeration();
	void loadUsers();
	// Nạp danh sách lớp TRƯỚC khi nạp thống kê: ô chọn lớp phải có sẵn lựa chọn thì
	// lần tải đầu mới hiển thị đúng cái giáo viên đang nhìn.
	await loadClasses();
	await loadStats();

	// Đăng ký SAU lần nạp đầu để không gọi `/api/admin/stats` hai lần lúc mở trang.
	//
	// Vì sao cần: `statsQuery()` gửi `level=<lớp đang chọn>`, nhưng trang legacy KHÔNG
	// nạp lại thống kê khi đổi lớp — bấm sang Lớp 7 thì bảng thống kê vẫn là số của
	// Lớp 6 và không có gì nói ra điều đó. Đây là lỗi thật, sửa ở P2-7.
	onLevelDataReloaded(() => {
		void loadStats();
	});
}

async function unlockAdminPage(payload: SessionPayload): Promise<void> {
	requireElement("admin-auth-shell").classList.add("hidden");
	requireElement("admin-page").classList.remove("hidden");
	showAuthError("");
	applyIdentity(payload);
	await initializeAdminPage();
}

async function handleLogin(event: SubmitEvent): Promise<void> {
	event.preventDefault();

	const usernameInput = requireInput("admin-username-input");
	const passwordInput = requireInput("admin-password-input");
	const submitButton = requireElement<HTMLButtonElement>("admin-auth-form").querySelector<HTMLButtonElement>(
		'button[type="submit"]'
	);

	showAuthError("");

	if (submitButton !== null) {
		submitButton.disabled = true;
	}

	try {
		const payload = await requestJson<SessionPayload>("/api/admin/login", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			// Bỏ trống tên đăng nhập = tài khoản `admin` (server tự ngã về). Giữ đúng
			// hành vi trang legacy: giáo viên chỉ gõ mật khẩu là vào được như trước.
			body: JSON.stringify({ username: usernameInput.value.trim(), password: passwordInput.value })
		});

		passwordInput.value = "";
		await unlockAdminPage({ ...payload, multiAccount: payload.multiAccount ?? true });
	} catch (error) {
		showAuthError(error instanceof Error ? error.message : "Không thể đăng nhập admin.");
		passwordInput.select();
	} finally {
		if (submitButton !== null) {
			submitButton.disabled = false;
		}
	}
}

async function handleLogout(): Promise<void> {
	try {
		await requestJson("/api/admin/logout", { method: "POST" });
		window.location.reload();
	} catch (error) {
		reportError(error);
	}
}

async function bootstrap(): Promise<void> {
	hideNotice();
	requireElement<HTMLFormElement>("admin-auth-form").addEventListener("submit", (event) => {
		void handleLogin(event);
	});
	requireElement("admin-logout-button").addEventListener("click", () => {
		void handleLogout();
	});

	showAuthShell();

	try {
		const payload = await requestJson<SessionPayload>("/api/admin/session");

		if (payload.authenticated === true) {
			await unlockAdminPage(payload);
			return;
		}

		requireInput("admin-password-input").focus();
	} catch (error) {
		showAuthError(error instanceof Error ? error.message : "Không thể kiểm tra phiên đăng nhập.");
	}
}

bootstrap().catch((error: unknown) => {
	console.error(error);

	const message = error instanceof Error ? error.message : "Không mở được trang quản trị.";

	try {
		showNotice(message, "error");
	} catch {
		// Hỏng tới mức không còn thanh thông báo (thiếu id trong admin.html) thì vẫn
		// phải nói ra chuyện gì xảy ra, thay vì để giáo viên nhìn một trang trắng.
		document.body.innerHTML =
			'<p style="padding:32px;font:16px system-ui;color:#f3f7fb">Không mở được trang quản trị: ' +
			escapeHtml(message) +
			"</p>";
	}
});
