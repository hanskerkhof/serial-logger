import { ChangeDetectionStrategy, Component, OnDestroy, input, signal } from '@angular/core';

@Component({
  selector: 'app-copy-to-clipboard',
  standalone: true,
  imports: [],
  templateUrl: './copy-to-clipboard.component.html',
  styleUrl: './copy-to-clipboard.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CopyToClipboardComponent implements OnDestroy {
  readonly value = input.required<string>();

  protected readonly copied = signal(false);
  private hideTimer: ReturnType<typeof setTimeout> | null = null;

  protected onCopy(): void {
    const text = this.value();
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.copied.set(true);
      if (this.hideTimer) clearTimeout(this.hideTimer);
      this.hideTimer = setTimeout(() => {
        this.copied.set(false);
        this.hideTimer = null;
      }, 2000);
    });
  }

  ngOnDestroy(): void {
    if (this.hideTimer) clearTimeout(this.hideTimer);
  }
}
