// Bootstrap V2. Chỉ làm 3 việc: tìm container, dựng Game shell, chạy scene đầu.
// Mọi logic nằm trong core/scenes — file này cố ý mỏng.

import "@/ui/ui-tokens.css";
import { App } from "@/App";
import { Game } from "@/core/Game";
import { DemoScene } from "@/scenes/DemoScene";

async function bootstrap(): Promise<void> {
	const container = document.querySelector<HTMLDivElement>("#app");
	const uiRoot = document.querySelector<HTMLDivElement>("#ui-root");

	if (container === null || uiRoot === null) {
		throw new Error("Thiếu #app hoặc #ui-root trong index.html.");
	}

	const params = new URLSearchParams(window.location.search);
	const modelName = params.get("model");

	// --- Chế độ dev (chỉ khi có ?debug) -------------------------------------
	if (params.has("debug") === true && modelName !== null && modelName !== "") {
		const game = new Game(container, uiRoot);
		const { ModelViewerScene } = await import("@/scenes/ModelViewerScene");
		await game.setScene(new ModelViewerScene(modelName));
		game.start();
		registerHotDispose(() => {
			game.dispose();
		});
		return;
	}

	if (params.has("scene") === true || params.has("autorun") === true) {
		const game = new Game(container, uiRoot);
		const { RunScene } = await import("@/scenes/RunScene");
		await game.setScene(new RunScene(params.get("level") ?? "lop6"));
		game.start();
		registerHotDispose(() => {
			game.dispose();
		});
		return;
	}

	if (params.has("demo") === true) {
		const game = new Game(container, uiRoot);
		await game.setScene(new DemoScene());
		game.start();
		registerHotDispose(() => {
			game.dispose();
		});
		return;
	}

	// --- Luồng thật: App điều phối màn hình ----------------------------------
	const app = new App(container, uiRoot);
	await app.start();
	registerHotDispose(() => {
		app.dispose();
	});
}

/** Dev/HMR: dọn WebGL context cũ, tránh rò context sau vài lần sửa file. */
function registerHotDispose(dispose: () => void): void {
	if (import.meta.hot !== undefined) {
		import.meta.hot.dispose(dispose);
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
