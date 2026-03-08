/**
 * A minimal EventEmitter compatible with React Native's bundler.
 * Replaces Node's built-in `events` module which is not available in RN.
 */
type Listener = (...args: any[]) => void;

export class EventEmitter {
  private _listeners: Map<string, Listener[]> = new Map();

  on(event: string, listener: Listener): this {
    const list = this._listeners.get(event) ?? [];
    this._listeners.set(event, [...list, listener]);
    return this;
  }

  once(event: string, listener: Listener): this {
    const wrapper = (...args: any[]) => {
      this.off(event, wrapper);
      listener(...args);
    };
    return this.on(event, wrapper);
  }

  off(event: string, listener: Listener): this {
    const list = this._listeners.get(event);
    if (list) {
      this._listeners.set(
        event,
        list.filter((l) => l !== listener),
      );
    }
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const list = this._listeners.get(event);
    if (!list?.length) return false;
    list.forEach((l) => {
      try {
        l(...args);
      } catch (e) {
        console.warn(`[EventEmitter] ${event} listener threw:`, e);
      }
    });
    return true;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this._listeners.delete(event);
    } else {
      this._listeners.clear();
    }
    return this;
  }
}
