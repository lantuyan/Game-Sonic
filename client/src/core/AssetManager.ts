// Nạp asset + báo tiến độ THẬT cho màn splash (S1).
//
// Đọc bản kê `assets.json` do `scripts/assets-build.mjs` sinh ra — nhờ vậy danh sách
// file không bị chép tay ở hai nơi. Mọi GLB đều nén meshopt nên loader phải gắn
// MeshoptDecoder, nếu không three sẽ ném lỗi "no DRACOLoader/MeshoptDecoder instance".

import { AnimationClip, Group, LoadingManager, Texture, TextureLoader } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";

export interface CharacterAsset {
	id: string;
	legacyId: string;
	label: string;
	url: string;
	clips: string[];
	bytes: number;
}

export interface PropAsset {
	url: string;
	group: string;
	bytes: number;
}

export interface AssetManifest {
	characters: CharacterAsset[];
	props: PropAsset[];
	particles: string[];
	icons: string[];
	audio: string[];
	clipFallbacks: string[];
}

export interface LoadedModel {
	scene: Group;
	clips: AnimationClip[];
}

export type ProgressListener = (loaded: number, total: number, url: string) => void;

export class AssetManager {
	private readonly loadingManager = new LoadingManager();
	private readonly gltfLoader: GLTFLoader;
	private readonly textureLoader: TextureLoader;
	private readonly modelCache = new Map<string, LoadedModel>();
	private readonly textureCache = new Map<string, Texture>();
	private readonly baseUrl: string;

	private manifest: AssetManifest | null = null;

	constructor(baseUrl = import.meta.env.BASE_URL) {
		this.baseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
		this.gltfLoader = new GLTFLoader(this.loadingManager).setMeshoptDecoder(MeshoptDecoder);
		this.textureLoader = new TextureLoader(this.loadingManager);
	}

	onProgress(listener: ProgressListener): void {
		this.loadingManager.onProgress = (url, loaded, total) => {
			listener(loaded, total, url);
		};
	}

	private resolve(url: string): string {
		return `${this.baseUrl}${url}`;
	}

	async loadManifest(): Promise<AssetManifest> {
		if (this.manifest !== null) {
			return this.manifest;
		}

		const response = await fetch(this.resolve("assets.json"));

		if (response.ok === false) {
			throw new Error(`Không nạp được assets.json (HTTP ${response.status}). Đã chạy \`npm run assets:build\` chưa?`);
		}

		this.manifest = (await response.json()) as AssetManifest;
		return this.manifest;
	}

	async loadModel(url: string): Promise<LoadedModel> {
		const cached = this.modelCache.get(url);

		if (cached !== undefined) {
			return cached;
		}

		const gltf = await this.gltfLoader.loadAsync(this.resolve(url));
		const model: LoadedModel = { scene: gltf.scene, clips: gltf.animations };
		this.modelCache.set(url, model);
		return model;
	}

	async loadTexture(url: string): Promise<Texture> {
		const cached = this.textureCache.get(url);

		if (cached !== undefined) {
			return cached;
		}

		const texture = await this.textureLoader.loadAsync(this.resolve(url));
		this.textureCache.set(url, texture);
		return texture;
	}

	/** Bộ tối thiểu để vào ván: 1 nhân vật đang chọn + toàn bộ props biome ①. */
	async preloadForRun(characterId: string): Promise<void> {
		const manifest = await this.loadManifest();
		const character = manifest.characters.find((entry) => entry.id === characterId) ?? manifest.characters[0];

		if (character === undefined) {
			throw new Error("assets.json không khai báo nhân vật nào.");
		}

		await Promise.all([
			this.loadModel(character.url),
			...manifest.props.map((prop) => this.loadModel(prop.url))
		]);
	}

	getCachedModel(url: string): LoadedModel | undefined {
		return this.modelCache.get(url);
	}

	dispose(): void {
		for (const texture of this.textureCache.values()) {
			texture.dispose();
		}

		this.textureCache.clear();
		this.modelCache.clear();
	}
}
