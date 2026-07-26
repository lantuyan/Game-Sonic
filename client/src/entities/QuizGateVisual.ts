// Cổng đáp án dựng bằng CODE (plan §6.2 — "tự dựng", không dùng asset ngoài):
// khung torus emissive + tấm canvas texture in đáp án tiếng Việt.
//
// Vì sao canvas texture cho chữ trên cổng: đây là NGOẠI LỆ DUY NHẤT của luật
// "text là DOM" (plan §5.2) — chữ phải nằm trong không gian 3D để người chơi biết
// lái vào làn nào. Đề bài vẫn là DOM ở HUD.

import {
	CanvasTexture,
	Color,
	DoubleSide,
	Group,
	Mesh,
	MeshBasicMaterial,
	MeshStandardMaterial,
	PlaneGeometry,
	TorusGeometry,
	type Object3D
} from "three";
import { tuning } from "@/tuning";
import { laneToX } from "@/entities/PlayerMotion";

const LABEL_WIDTH = 512;
const LABEL_HEIGHT = 256;
const GATE_RADIUS = 1.05;

const COLOR_IDLE = 0x2e86ff;
const COLOR_CORRECT = 0x22c55e;
const COLOR_WRONG = 0xef4444;

export class QuizGateVisual {
	readonly group = new Group();

	private readonly ring: Mesh;
	private readonly label: Mesh;
	private readonly canvas: HTMLCanvasElement;
	private readonly context: CanvasRenderingContext2D | null;
	private readonly texture: CanvasTexture;
	private readonly ringMaterial: MeshStandardMaterial;

	private active = false;

	constructor() {
		this.ringMaterial = new MeshStandardMaterial({
			color: new Color(COLOR_IDLE),
			emissive: new Color(COLOR_IDLE),
			emissiveIntensity: 0.85,
			roughness: 0.35,
			metalness: 0.1
		});

		this.ring = new Mesh(new TorusGeometry(GATE_RADIUS, 0.12, 10, 28), this.ringMaterial);
		this.ring.position.y = GATE_RADIUS + 0.15;

		this.canvas = document.createElement("canvas");
		this.canvas.width = LABEL_WIDTH;
		this.canvas.height = LABEL_HEIGHT;
		this.context = this.canvas.getContext("2d");
		this.texture = new CanvasTexture(this.canvas);

		this.label = new Mesh(
			new PlaneGeometry(1.7, 0.85),
			new MeshBasicMaterial({ map: this.texture, transparent: true, side: DoubleSide, depthWrite: false })
		);
		this.label.position.y = GATE_RADIUS + 0.15;
		this.label.position.z = 0.02;

		this.group.add(this.ring, this.label);
		this.group.visible = false;
		this.group.name = "quiz-gate";
	}

	/** Bật cổng ở làn + z cho trước với nội dung đáp án. */
	show(lane: number, z: number, answerKey: string, answerText: string): void {
		this.active = true;
		this.group.visible = true;
		this.group.position.set(laneToX(lane), 0, z);
		this.setColor(COLOR_IDLE);
		this.drawLabel(answerKey, answerText);
	}

	hide(): void {
		this.active = false;
		this.group.visible = false;
	}

	get isActive(): boolean {
		return this.active;
	}

	get z(): number {
		return this.group.position.z;
	}

	/** Đẩy cổng về phía player cùng nhịp thế giới. */
	advance(units: number): void {
		this.group.position.z += units;
	}

	flashCorrect(): void {
		this.setColor(COLOR_CORRECT);
	}

	flashWrong(): void {
		this.setColor(COLOR_WRONG);
	}

	private setColor(hex: number): void {
		this.ringMaterial.color.setHex(hex);
		this.ringMaterial.emissive.setHex(hex);
	}

	private drawLabel(answerKey: string, answerText: string): void {
		const context = this.context;

		if (context === null) {
			return;
		}

		context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

		context.fillStyle = "rgba(12, 22, 44, 0.88)";
		context.fillRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT);

		context.fillStyle = "#ffc93c";
		context.font = "bold 56px 'Baloo 2', system-ui, sans-serif";
		context.textAlign = "center";
		context.textBaseline = "top";
		context.fillText(answerKey, LABEL_WIDTH / 2, 18);

		context.fillStyle = "#ffffff";
		context.textBaseline = "middle";
		// Cỡ chữ co lại theo độ dài để đáp án dài vẫn nằm gọn trong tấm.
		const fontSize = answerText.length > 12 ? 54 : answerText.length > 7 ? 68 : 86;
		context.font = `bold ${fontSize}px 'Nunito', system-ui, sans-serif`;
		context.fillText(answerText, LABEL_WIDTH / 2, LABEL_HEIGHT / 2 + 30, LABEL_WIDTH - 40);

		this.texture.needsUpdate = true;
	}

	attachTo(parent: Object3D): void {
		parent.add(this.group);
	}

	dispose(): void {
		this.ring.geometry.dispose();
		this.ringMaterial.dispose();
		this.label.geometry.dispose();
		(this.label.material as MeshBasicMaterial).dispose();
		this.texture.dispose();
	}
}

/** Khoảng z player được coi là "đã chạy xuyên cổng". */
export const GATE_TRIGGER_HALF_DEPTH = 1.1;

export function gateSpawnZ(): number {
	return -tuning.quiz.gateSpawnDistance;
}
