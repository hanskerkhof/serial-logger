import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  inject,
  signal,
} from '@angular/core';
import QrScanner from 'qr-scanner';

@Component({
  selector: 'app-qr-scanner-demo',
  standalone: true,
  templateUrl: './qr-scanner-demo.component.html',
  styleUrl: './qr-scanner-demo.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrScannerDemoComponent implements AfterViewInit {
  @ViewChild('videoEl') private videoElementRef?: ElementRef<HTMLVideoElement>;

  private readonly destroyRef = inject(DestroyRef);

  protected readonly status = signal<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly lastDetectedQrText = signal<string | null>(null);
  private scanner: QrScanner | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.stopScanner();
    });
  }

  ngAfterViewInit(): void {
    void this.startScanner();
  }

  private async startScanner(): Promise<void> {
    this.status.set('starting');
    this.errorMessage.set(null);

    try {
      const videoElement = this.videoElementRef?.nativeElement;
      if (!videoElement) {
        this.status.set('error');
        this.errorMessage.set('Camera view is not ready.');
        return;
      }

      this.scanner = new QrScanner(
        videoElement,
        (decoded) => {
          const value = decoded.data.trim();
          if (value) this.lastDetectedQrText.set(value);
        },
        {
          preferredCamera: 'environment',
          returnDetailedScanResult: true,
          highlightScanRegion: false,
          highlightCodeOutline: false,
          onDecodeError: () => {
            // Ignore per-frame decode misses; keep scanning silently.
          },
        },
      );
      await this.scanner.start();

      this.status.set('scanning');
    } catch (error) {
      this.status.set('error');
      this.errorMessage.set(error instanceof Error ? error.message : 'Failed to start camera scanner.');
    }
  }

  private stopScanner(): void {
    this.scanner?.stop();
    this.scanner?.destroy();
    this.scanner = null;
  }
}
