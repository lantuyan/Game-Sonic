// Overlay `?debug`: đồ thị frame-time, draw calls, số object trong pool, và panel
// chỉnh nóng `tuning.ts`. Tự viết bằng DOM — KHÔNG thêm thư viện (quy tắc vàng).
//
// Toàn bộ file này chỉ chạy khi URL có `?debug`; bản release vẫn nạp nhưng không
// dựng gì (bundle nhỏ, không cần code-split riêng ở P0).

import { listTuningPaths, getTuningValue, setTuningValue } from "@/tuning";
import type { RendererStats } from "@/core/Renderer";

const GRAPH_WIDTH = 132;
const GRAPH_HEIGHT = 40;
/** 33.3ms = 30fps: vạch đỏ cảnh báo trên đồ thị. */
const GRAPH_MAX_MS = 33.3;

export interface DebugSample {
	frameMs: number;
	stats: RendererStats;
	/** Số object đang sống trong các pool (Track/Coin/Obstacle…). */
	poolCounts: Readonly<Record<string, number>>;
	extra?: Readonly<Record<string, string | number>>;
}

export function isDebugEnabled(): boolean {
	return new URLSearchParams(window.location.search).has("debug");
}

export class DebugOverlay {
	private readonly root: HTMLDivElement;
	private readonly readout: HTMLDivElement;
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D | null;
	private readonly history: number[] = [];

	private accumulatorSec = 0;
	private frames = 0;
	private fps = 0;

	constructor(parent: HTMLElement = document.body) {
		this.root = document.createElement("div");
		this.root.id = "debug-overlay";
		this.root.setAttribute("data-testid", "debug-overlay");
		this.root.style.cssText = [
			"position:fixed",
			"top:8px",
			"left:8px",
			"z-index:9999",
			"font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace",
			"color:#d7e6ff",
			"background:rgba(8,16,32,.86)",
			"border:1px solid rgba(120,170,255,.35)",
			"border-radius:8px",
			"padding:8px",
			"pointer-events:auto",
			"max-height:88vh",
			"overflow:auto",
			"min-width:180px"
		].join(";");

		this.canvas = document.createElement("canvas");
		this.canvas.width = GRAPH_WIDTH;
		this.canvas.height = GRAPH_HEIGHT;
		this.canvas.style.cssText = "display:block;width:132px;height:40px;background:rgba(0,0,0,.35);border-radius:4px";
		this.context = this.canvas.getContext("2d");

		this.readout = document.createElement("div");
		this.readout.style.marginTop = "6px";

		this.root.append(this.canvas, this.readout, this.buildTuningPanel());
		parent.appendChild(this.root);
	}

	private buildTuningPanel(): HTMLElement {
		const details = document.createElement("details");
		details.style.marginTop = "8px";

		const summary = document.createElement("summary");
		summary.textContent = "tuning (chỉnh nóng)";
		summary.style.cssText = "cursor:pointer;color:#ffc93c;margin-bottom:6px";
		details.appendChild(summary);

		const filter = document.createElement("input");
		filter.type = "search";
		filter.placeholder = "lọc… vd: jump";
		filter.style.cssText = "width:100%;margin-bottom:6px;font:inherit;padding:2px 4px";
		details.appendChild(filter);

		const list = document.createElement("div");
		details.appendChild(list);

		const rows: Array<{ path: string; row: HTMLElement }> = [];

		for (const path of listTuningPaths()) {
			const row = document.createElement("label");
			row.style.cssText = "display:flex;gap:6px;align-items:center;justify-content:space-between;margin:2px 0";

			const label = document.createElement("span");
			label.textContent = path;
			label.style.cssText = "opacity:.8;white-space:nowrap";

			const field = document.createElement("input");
			field.type = "number";
			field.step = "any";
			field.value = String(getTuningValue(path) ?? 0);
			field.style.cssText = "width:74px;font:inherit;padding:1px 3px";
			field.addEventListener("input", () => {
				const numericValue = Number(field.value);

				if (Number.isFinite(numericValue) === true) {
					setTuningValue(path, numericValue);
				}
			});

			row.append(label, field);
			list.appendChild(row);
			rows.push({ path, row });
		}

		filter.addEventListener("input", () => {
			const needle = filter.value.trim().toLowerCase();

			for (const entry of rows) {
				entry.row.style.display = needle === "" || entry.path.toLowerCase().includes(needle) ? "flex" : "none";
			}
		});

		return details;
	}

	update(realDeltaSec: number, sample: DebugSample): void {
		this.accumulatorSec += realDeltaSec;
		this.frames += 1;

		this.history.push(sample.frameMs);

		if (this.history.length > GRAPH_WIDTH) {
			this.history.shift();
		}

		if (this.accumulatorSec >= 0.25) {
			this.fps = this.frames / this.accumulatorSec;
			this.accumulatorSec = 0;
			this.frames = 0;
			this.renderReadout(sample);
		}

		this.renderGraph();
	}

	private renderGraph(): void {
		const context = this.context;

		if (context === null) {
			return;
		}

		context.clearRect(0, 0, GRAPH_WIDTH, GRAPH_HEIGHT);

		// Vạch 16.7ms (60fps) — dưới vạch là tốt.
		context.strokeStyle = "rgba(34,197,94,.55)";
		const goodY = GRAPH_HEIGHT - (16.7 / GRAPH_MAX_MS) * GRAPH_HEIGHT;
		context.beginPath();
		context.moveTo(0, goodY);
		context.lineTo(GRAPH_WIDTH, goodY);
		context.stroke();

		context.beginPath();

		for (let index = 0; index < this.history.length; index += 1) {
			const value = this.history[index] ?? 0;
			const y = GRAPH_HEIGHT - Math.min(value / GRAPH_MAX_MS, 1) * GRAPH_HEIGHT;

			if (index === 0) {
				context.moveTo(index, y);
			} else {
				context.lineTo(index, y);
			}
		}

		const lastValue = this.history[this.history.length - 1] ?? 0;
		context.strokeStyle = lastValue > 20 ? "#ef4444" : "#2e86ff";
		context.stroke();
	}

	private renderReadout(sample: DebugSample): void {
		const poolText = Object.entries(sample.poolCounts)
			.map(([name, count]) => `${name}:${count}`)
			.join(" ");
		const extraText = Object.entries(sample.extra ?? {})
			.map(([name, value]) => `${name}: ${value}`)
			.join("<br />");

		this.readout.innerHTML = [
			`<strong>${this.fps.toFixed(0)} fps</strong> · ${sample.frameMs.toFixed(1)} ms`,
			`draws: <strong style="color:${sample.stats.drawCalls > 100 ? "#ef4444" : "#22c55e"}">${sample.stats.drawCalls}</strong> · tris: ${formatCount(sample.stats.triangles)}`,
			`geo: ${sample.stats.geometries} · tex: ${sample.stats.textures} · prog: ${sample.stats.programs}`,
			poolText === "" ? "" : `pool: ${poolText}`,
			extraText
		]
			.filter((line) => line !== "")
			.join("<br />");
	}

	dispose(): void {
		this.root.remove();
	}
}

function formatCount(value: number): string {
	if (value >= 1000) {
		return `${(value / 1000).toFixed(1)}k`;
	}

	return String(value);
}
