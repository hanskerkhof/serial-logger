import { Pipe, PipeTransform } from '@angular/core';

/**
 * Formats a duration in seconds as a compact human-readable string.
 *
 * Rules:
 *   - Days shown only when ≥ 1 day
 *   - Hours shown only when ≥ 1 hour
 *   - Minutes shown only when ≥ 1 minute
 *   - Seconds always shown (unless days are present — dropped for readability)
 *
 * Examples:
 *   45        → '45s'
 *   272       → '4m 32s'
 *   7832      → '2h 10m 32s'
 *   90061     → '1d 1h 1m'
 *
 * Usage in templates:  {{ uptimeSeconds | duration }}
 */
@Pipe({ name: 'duration' })
export class DurationPipe implements PipeTransform {
  transform(totalSeconds: number | null | undefined): string {
    if (totalSeconds == null || totalSeconds < 0) return '—';

    const s = Math.floor(totalSeconds);
    const days = Math.floor(s / 86400);
    const hours = Math.floor((s % 86400) / 3600);
    const minutes = Math.floor((s % 3600) / 60);
    const seconds = s % 60;

    const parts: string[] = [];

    if (days > 0) parts.push(`${days}d`);
    if (hours > 0) parts.push(`${hours}h`);
    if (minutes > 0) parts.push(`${minutes}m`);
    // Drop seconds when days are shown — the precision is not meaningful at that scale.
    if (days === 0) parts.push(`${seconds}s`);

    return parts.join(' ') || '0s';
  }
}
