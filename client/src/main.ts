// Smoke test P0-1: canvas Three.js quay 1 cube.
// Engine thật (fixed timestep, quality, input…) vào ở P0-2 — file này chỉ chứng minh
// khung Vite + TS + three@0.185 chạy được trên dev lẫn build production.
import {
	BoxGeometry,
	Color,
	DirectionalLight,
	HemisphereLight,
	Mesh,
	MeshStandardMaterial,
	PerspectiveCamera,
	Scene,
	SRGBColorSpace,
	WebGLRenderer
} from "three";

function bootstrap(): void {
	const container = document.querySelector<HTMLDivElement>("#app");

	if (container === null) {
		throw new Error("Không tìm thấy #app để gắn canvas.");
	}

	const renderer = new WebGLRenderer({ antialias: true });
	renderer.outputColorSpace = SRGBColorSpace;
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	renderer.setSize(container.clientWidth, container.clientHeight);
	container.appendChild(renderer.domElement);

	const scene = new Scene();
	scene.background = new Color("#1B2A4A");

	const camera = new PerspectiveCamera(60, container.clientWidth / container.clientHeight, 0.1, 100);
	camera.position.set(0, 1.2, 4);
	camera.lookAt(0, 0, 0);

	scene.add(new HemisphereLight("#ffffff", "#22345a", 1.1));
	const sun = new DirectionalLight("#ffffff", 1.4);
	sun.position.set(3, 5, 2);
	scene.add(sun);

	const cube = new Mesh(
		new BoxGeometry(1.4, 1.4, 1.4),
		new MeshStandardMaterial({ color: "#FFC93C", roughness: 0.35, metalness: 0.1 })
	);
	scene.add(cube);

	window.addEventListener("resize", () => {
		camera.aspect = container.clientWidth / container.clientHeight;
		camera.updateProjectionMatrix();
		renderer.setSize(container.clientWidth, container.clientHeight);
	});

	let previousTime = performance.now();

	function frame(time: number): void {
		const dt = Math.min((time - previousTime) / 1000, 1 / 30);
		previousTime = time;

		cube.rotation.x += dt * 0.9;
		cube.rotation.y += dt * 1.4;
		renderer.render(scene, camera);
		requestAnimationFrame(frame);
	}

	requestAnimationFrame(frame);
}

bootstrap();
