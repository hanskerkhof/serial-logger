import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a duration in milliseconds as a compact clock string:
 *   - Always shows m:ss (minutes and seconds, zero-padded seconds)
 *   - Prepends h: only when duration ≥ 1 hour (zero-padded minutes)
 *   - Hours omitted for durations < 1 hour
 *
 * Examples:
 *   0          → '0:00'
 *   4200       → '0:04'
 *   90000      → '1:30'
 *   226000     → '3:46'
 *   3723000    → '1:02:03'
 *
 * Usage in templates:  {{ durationMs | playbackMs }}
 * Usage in TS:         formatPlaybackMs(durationMs)
 */
export function formatPlaybackMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

@Pipe({ name: 'playbackMs' })
export class PlaybackMsPipe implements PipeTransform {
  transform(ms: number | null | undefined): string {
    if (ms == null || !Number.isFinite(ms) || ms < 0) return '—';
    return formatPlaybackMs(ms);
  }
}
