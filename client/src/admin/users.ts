// P2-7 · Tài khoản quản trị (`admin_users`) — panel MỚI của task này.
//
// Hai điều panel này phải nói ra bằng lời, không chỉ bằng code:
//
//   1. **Lớp học thuộc về TÀI KHOẢN đã tạo ra chúng.** Tạo tài khoản mới cho một
//      thầy cô nghĩa là thầy cô đó bắt đầu với danh sách lớp trống — không phải
//      trang bị hỏng. Câu này in ngay trên panel.
//   2. **`ADMIN_PASSWORD_HASH` vẫn là một chìa khoá còn hiệu lực** cho tài khoản
//      `admin` cho tới khi chủ dự án XOÁ biến môi trường đó. Giấu chuyện này đi là
//      để nhà trường tưởng mình đã đóng một cánh cửa vẫn đang mở.

import { adminFetch, deleteJson, postJson } from "@/admin/api";
import { bindDataButtons, escapeHtml, formatTimestamp, requireElement, requireInput, requireSelect } from "@/admin/dom";
import { reportError, showNotice } from "@/admin/shell";
import { state } from "@/admin/state";

interface AdminUserRow {
	username: string;
	displayName: string;
	role: "owner" | "teacher";
	createdAt: string;
	lastLoginAt: string | null;
}

function roleLabel(role: string): string {
	return role === "owner" ? "Quản trị chính" : "Giáo viên";
}

function renderUsers(users: AdminUserRow[]): void {
	const tableBody = requireElement("users-table-body");

	if (users.length === 0) {
		tableBody.innerHTML = '<tr><td colspan="5" class="empty">Chưa có tài khoản nào.</td></tr>';
		return;
	}

	tableBody.innerHTML = users
		.map((user) => {
			const isSelf = user.username === state.identity.username;

			return (
				"<tr>" +
				`<td><strong>${escapeHtml(user.username)}</strong>${isSelf ? ' <span class="muted">(bạn)</span>' : ""}</td>` +
				`<td>${escapeHtml(user.displayName)}</td>` +
				`<td>${escapeHtml(roleLabel(user.role))}</td>` +
				`<td class="small">${escapeHtml(formatTimestamp(user.lastLoginAt))}</td>` +
				"<td>" +
				// Không hiện nút xoá cho CHÍNH MÌNH: server cũng từ chối, nhưng một cái
				// nút chỉ để báo lỗi là một cái bẫy chứ không phải một tính năng.
				(isSelf
					? '<span class="muted small">—</span>'
					: `<button type="button" class="button-warning" data-delete-user="${escapeHtml(user.username)}">Xoá</button> ` +
						`<button type="button" class="button-secondary" data-reset-user="${escapeHtml(user.username)}">Đặt lại mật khẩu</button>`) +
				"</td>" +
				"</tr>"
			);
		})
		.join("");

	bindDataButtons(tableBody, "data-delete-user", (username) => {
		if (
			window.confirm(
				`Xoá tài khoản "${username}"? Lớp học của tài khoản này KHÔNG bị xoá — tạo lại đúng tên đăng nhập là nhận lại các lớp cũ.`
			) !== true
		) {
			return;
		}

		void deleteJson(`/api/admin/users/${encodeURIComponent(username)}`)
			.then(async () => {
				showNotice(`Đã xoá tài khoản “${username}”.`, "success");
				await loadUsers();
			})
			.catch(reportError);
	});

	bindDataButtons(tableBody, "data-reset-user", (username) => {
		const password = window.prompt(`Mật khẩu mới cho “${username}” (ít nhất 8 ký tự):`);

		if (password === null || password === "") {
			return;
		}

		void postJson(`/api/admin/users/${encodeURIComponent(username)}/password`, { password })
			.then(() => {
				showNotice(`Đã đặt lại mật khẩu cho “${username}”. Nhớ báo lại cho thầy cô đó.`, "success");
			})
			.catch(reportError);
	});
}

/**
 * Panel này hiện KHÁC NHAU theo quyền:
 *   · chưa nối CSDL  → chỉ có một tài khoản `admin` từ biến môi trường, không tạo
 *     thêm được; nói thẳng ra thay vì để nút tạo báo lỗi khi bấm;
 *   · `teacher`      → chỉ thấy khối "Đổi mật khẩu của tôi";
 *   · `owner`        → thấy đủ.
 */
export function applyIdentityToUsersPanel(): void {
	const ownerOnly = requireElement("users-owner-only");
	const warning = requireElement("users-warning");

	if (state.identity.multiAccount !== true) {
		ownerOnly.classList.add("hidden");
		warning.className = "notice notice-info";
		warning.textContent =
			"Server chưa nối cơ sở dữ liệu nên chỉ có một tài khoản admin dùng chung (mật khẩu nằm trong biến môi trường " +
			"ADMIN_PASSWORD_HASH). Chạy migrate rồi tải lại trang để dùng nhiều tài khoản.";
		return;
	}

	if (state.identity.role !== "owner") {
		ownerOnly.classList.add("hidden");
		warning.className = "notice notice-info";
		warning.textContent =
			"Tài khoản của thầy cô là tài khoản giáo viên: chỉ đổi được mật khẩu của chính mình. " +
			"Cần thêm tài khoản thì nhờ người giữ tài khoản quản trị chính.";
		return;
	}

	ownerOnly.classList.remove("hidden");
	warning.className = "notice notice-info";
	warning.textContent =
		"Lưu ý bảo mật: mật khẩu cũ trong biến môi trường ADMIN_PASSWORD_HASH VẪN đăng nhập được vào tài khoản “admin”. " +
		"Sau khi đã tạo xong tài khoản riêng cho từng thầy cô, hãy xoá biến đó trên Vercel rồi deploy lại.";
}

export async function loadUsers(): Promise<void> {
	if (state.identity.multiAccount !== true || state.identity.role !== "owner") {
		return;
	}

	try {
		const payload = await adminFetch<{ users?: AdminUserRow[] }>("/api/admin/users");
		renderUsers(payload.users ?? []);
	} catch (error) {
		reportError(error);
	}
}

async function createUser(): Promise<void> {
	try {
		const result = await postJson<{ user: AdminUserRow }>("/api/admin/users", {
			username: requireInput("user-username").value.trim(),
			displayName: requireInput("user-display-name").value.trim(),
			password: requireInput("user-password").value,
			role: requireSelect("user-role").value
		});

		showNotice(
			`Đã tạo tài khoản “${result.user.username}”. Tài khoản mới bắt đầu với danh sách lớp TRỐNG — lớp cũ vẫn thuộc về người đã tạo ra chúng.`,
			"success"
		);
		requireInput("user-username").value = "";
		requireInput("user-display-name").value = "";
		requireInput("user-password").value = "";
		await loadUsers();
	} catch (error) {
		reportError(error);
	}
}

async function changeOwnPassword(): Promise<void> {
	const password = requireInput("own-password").value;
	const confirmation = requireInput("own-password-confirm").value;

	if (password !== confirmation) {
		showNotice("Hai ô mật khẩu chưa giống nhau.", "error");
		return;
	}

	try {
		await postJson(`/api/admin/users/${encodeURIComponent(state.identity.username)}/password`, { password });
		requireInput("own-password").value = "";
		requireInput("own-password-confirm").value = "";
		showNotice("Đã đổi mật khẩu. Lần đăng nhập sau dùng mật khẩu mới nhé.", "success");
	} catch (error) {
		reportError(error);
	}
}

export function bindUsersPanel(): void {
	requireElement("users-refresh").addEventListener("click", () => {
		void loadUsers();
	});
	requireElement("user-create-button").addEventListener("click", () => {
		void createUser();
	});
	requireElement("own-password-button").addEventListener("click", () => {
		void changeOwnPassword();
	});
}
