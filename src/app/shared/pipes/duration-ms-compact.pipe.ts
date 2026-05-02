import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats milliseconds as a compact elapsed label:
 *   - seconds always shown with 1 decimal
 *   - minutes/hours shown only when non-zero
 *
 * Examples:
 *   420         -> 0.4s
 *   15340       -> 15.3s
 *   75400       -> 1m15.4s
 *   3723400     -> 1h2m3.4s
 */
@Pipe({ name: 'durationMsCompact' })
export class DurationMsCompactPipe implements PipeTransform {
  transform(totalMs: number | null | undefined): string {
    if (totalMs == null || !Number.isFinite(totalMs)) return '—';
    const clamped = Math.max(0, totalMs);
    const totalSeconds = clamped / 1000;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds - (hours * 3600) - (minutes * 60);

    let label = '';
    if (hours > 0) label += `${hours}h`;
    if (minutes > 0 || hours > 0) label += `${minutes}m`;
    label += `${seconds.toFixed(1)}s`;
    return label;
  }
}

