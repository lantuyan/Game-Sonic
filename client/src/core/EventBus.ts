// Pub/sub tối giản, gõ kiểu chặt. HUD/UI nghe qua đây thay vì query DOM mỗi frame
// (quy tắc vàng #6: đường nóng không cấp phát — `emit` không tạo array/closure mới).

export type Listener<Payload> = (payload: Payload) => void;

// `Events` là một interface liệt kê tên sự kiện → kiểu payload. Không ràng buộc
// `extends Record<string, unknown>` vì interface không có index signature.
export class EventBus<Events> {
	private readonly listenersByType = new Map<keyof Events, Set<Listener<never>>>();

	on<Type extends keyof Events>(type: Type, listener: Listener<Events[Type]>): () => void {
		let listeners = this.listenersByType.get(type);

		if (listeners === undefined) {
			listeners = new Set();
			this.listenersByType.set(type, listeners);
		}

		listeners.add(listener as Listener<never>);

		return () => {
			this.off(type, listener);
		};
	}

	once<Type extends keyof Events>(type: Type, listener: Listener<Events[Type]>): () => void {
		const off = this.on(type, (payload) => {
			off();
			listener(payload);
		});

		return off;
	}

	off<Type extends keyof Events>(type: Type, listener: Listener<Events[Type]>): void {
		this.listenersByType.get(type)?.delete(listener as Listener<never>);
	}

	emit<Type extends keyof Events>(type: Type, payload: Events[Type]): void {
		const listeners = this.listenersByType.get(type);

		if (listeners === undefined) {
			return;
		}

		// Set giữ thứ tự chèn; duyệt trực tiếp để không cấp phát mảng tạm mỗi frame.
		for (const listener of listeners) {
			(listener as Listener<Events[Type]>)(payload);
		}
	}

	clear(): void {
		this.listenersByType.clear();
	}
}
