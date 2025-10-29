import { Injectable } from '@angular/core';

interface CommandHistoryBlob {
  version: number;
  items: string[];
  updatedAt: number; // epoch ms
}

@Injectable({ providedIn: 'root' })
export class HistoryService {
  private readonly key = 'bauklank-serial-command-history';
  private readonly version = 1;

  /** Load the command history (safe parse with fallbacks). */
  load(): string[] {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return [];
      const blob = JSON.parse(raw) as Partial<CommandHistoryBlob>;
      if (!blob || !Array.isArray(blob.items)) return [];
      return blob.items as string[];
    } catch {
      return [];
    }
  }

  /** Save a full array to storage. */
  save(items: string[]): void {
    const blob: CommandHistoryBlob = {
      version: this.version,
      items,
      updatedAt: Date.now(),
    };
    localStorage.setItem(this.key, JSON.stringify(blob));
  }

  /** Remove all items. */
  clear(): void {
    localStorage.removeItem(this.key);
  }

  /** Push a new command to the *front* (dedupe head, limit length). Returns updated list. */
  pushFront(cmd: string, opts?: { dedupeHead?: boolean; max?: number }): string[] {
    const dedupeHead = opts?.dedupeHead ?? true;
    const max = Math.max(1, opts?.max ?? 50);

    const items = this.load();

    const trimmed = cmd.trim();
    if (!trimmed) return items;

    if (dedupeHead && items[0] === trimmed) {
      // no change
      return items;
    }
    // Remove any existing occurrence (global dedupe keeps list cleaner)
    const filtered = items.filter(i => i !== trimmed);
    filtered.unshift(trimmed);
    if (filtered.length > max) filtered.length = max;

    this.save(filtered);
    return filtered;
  }

  /** Delete one entry by index (0 = most recent). Returns updated list. */
  deleteAt(index: number): string[] {
    const items = this.load();
    if (index < 0 || index >= items.length) return items;
    items.splice(index, 1);
    this.save(items);
    return items;
  }
}
