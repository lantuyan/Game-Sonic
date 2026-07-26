// Đăng ký Service Worker + prompt "Đã có bản mới — Tải lại" (plan §7.3.5).
//
// Dùng `registerType: "prompt"` chứ không tự tải lại: học sinh đang chơi dở mà
// trang tự refresh là mất ván. Thay vào đó hiện một thanh nhỏ để tự bấm.

import { registerSW } from "virtual:pwa-register";

export function setupServiceWorker(uiRoot: HTMLElement): void {
	// Dev không đăng ký SW — sẽ cache mất file đang sửa.
	if (import.meta.env.DEV === true) {
		return;
	}

	if ("serviceWorker" in navigator === false) {
		return;
	}

	const updateSW = registerSW({
		onNeedRefresh() {
			showUpdatePrompt(uiRoot, () => {
				void updateSW(true);
			});
		},
		onOfflineReady() {
			showToast(uiRoot, "Đã tải xong — chơi được cả khi mất mạng.");
		},
		onRegisterError(error: unknown) {
			console.warn("[pwa] không đăng ký được service worker:", error);
		}
	});
}

function showUpdatePrompt(uiRoot: HTMLElement, onReload: () => void): void {
	const bar = document.createElement("div");
	bar.className = "update-prompt";
	bar.setAttribute("role", "status");

	const text = document.createElement("span");
	text.textContent = "Đã có bản mới";

	const reloadButton = document.createElement("button");
	reloadButton.type = "button";
	reloadButton.className = "button";
	reloadButton.textContent = "Tải lại";
	reloadButton.addEventListener("click", onReload);

	const laterButton = document.createElement("button");
	laterButton.type = "button";
	laterButton.className = "button update-prompt__later";
	laterButton.textContent = "Để sau";
	laterButton.addEventListener("click", () => {
		bar.remove();
	});

	bar.append(text, reloadButton, laterButton);
	uiRoot.appendChild(bar);
}

function showToast(uiRoot: HTMLElement, message: string): void {
	const toast = document.createElement("div");
	toast.className = "hud__toast";
	toast.setAttribute("role", "status");
	toast.textContent = message;
	uiRoot.appendChild(toast);

	window.setTimeout(() => {
		toast.remove();
	}, 3200);
}
