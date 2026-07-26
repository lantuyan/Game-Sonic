// Bootstrap V2. Chỉ làm 3 việc: tìm container, dựng Game shell, chạy scene đầu.
// Mọi logic nằm trong core/scenes — file này cố ý mỏng.

import { Game } from "@/core/Game";
import { DemoScene } from "@/scenes/DemoScene";

async function bootstrap(): Promise<void> {
	const container = document.querySelector<HTMLDivElement>("#app");
	const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

	if (container === null || uiRoot === null) {
		throw new Error("Thiếu #app hoặc #ui-root trong index.html.");
	}

	const game = new Game(container, uiRoot);
	await game.setScene(new DemoScene());
	game.start();

	// Dev/HMR: dọn sạch WebGL context cũ, tránh rò context sau vài lần sửa file.
	if (import.meta.hot !== undefined) {
		import.meta.hot.dispose(() => {
			game.dispose();
		});
	}
}

bootstrap().catch((error: unknown) => {
	console.error(error);

	const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

	if (uiRoot !== null) {
		uiRoot.innerHTML =
			"<div style=\"position:fixed;inset:0;display:grid;place-items:center;color:#fff;font:16px system-ui;background:#1b2a4a;pointer-events:auto;padding:24px;text-align:center\">" +
			"Không khởi động được trò chơi. Em thử tải lại trang nhé." +
			"</div>";
	}
});
