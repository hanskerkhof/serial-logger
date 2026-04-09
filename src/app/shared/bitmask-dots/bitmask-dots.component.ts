import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-bitmask-dots',
  standalone: true,
  templateUrl: './bitmask-dots.component.html',
  styleUrl: './bitmask-dots.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BitmaskDotsComponent {
  readonly value = input<number>(0);
  readonly bitCount = input<number>(12);

  protected readonly indices = computed<number[]>(() => {
    const rawCount = Number(this.bitCount());
    const count = Number.isFinite(rawCount) ? Math.max(1, Math.min(32, Math.trunc(rawCount))) : 12;
    return Array.from({ length: count }, (_unused, i) => i);
  });

  protected isOn(index: number): boolean {
    const rawValue = Number(this.value());
    const value = Number.isFinite(rawValue) ? (Math.trunc(rawValue) >>> 0) : 0;
    return (value & (1 << index)) !== 0;
  }
}

