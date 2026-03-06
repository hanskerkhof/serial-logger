import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { CommanderApiService, CommanderStreamEvent } from '../../../commander-api.service';

interface ConsoleLine {
  ts: number;
  type: string;
  text: string;
  request_id?: string;
  seq?: number;
}

@Component({
  selector: 'app-commander-console',
  standalone: true,
  templateUrl: './commander-console.component.html',
  styleUrl: './commander-console.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderConsoleComponent {
  apiBaseUrl = input.required<string>();

  protected readonly connected = signal(false);
  protected readonly streamError = signal<string | null>(null);
  protected readonly paused = signal(false);
  protected readonly autoScroll = signal(true);
  protected readonly showHeartbeatLines = signal(false);
  protected readonly heartbeatPulse = signal(false);
  protected readonly lastHeartbeatTs = signal<number | null>(null);
  protected readonly lines = signal<ConsoleLine[]>([]);

  @ViewChild('consoleBody') private consoleBody?: ElementRef<HTMLElement>;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly destroyRef = inject(DestroyRef);
  private disposeStream: (() => void) | null = null;
  private heartbeatPulseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const url = this.apiBaseUrl().trim();
      this.connect(url);
    });

    this.destroyRef.onDestroy(() => {
      this.disconnect();
      if (this.heartbeatPulseTimer) {
        clearTimeout(this.heartbeatPulseTimer);
        this.heartbeatPulseTimer = null;
      }
    });
  }

  protected togglePaused(): void {
    this.paused.set(!this.paused());
  }

  protected toggleAutoScroll(): void {
    this.autoScroll.set(!this.autoScroll());
    this.scrollToBottom();
  }

  protected toggleHeartbeatLines(): void {
    this.showHeartbeatLines.set(!this.showHeartbeatLines());
  }

  protected clear(): void {
    this.lines.set([]);
  }

  protected formatTimestamp(epochSeconds: number): string {
    const date = new Date(epochSeconds * 1000);
    return date.toLocaleTimeString('nl-NL', { hour12: false }) + `.${String(date.getMilliseconds()).padStart(3, '0')}`;
  }

  protected heartbeatTooltip(): string {
    const ts = this.lastHeartbeatTs();
    if (ts === null) {
      return 'Last heartbeat: not received yet';
    }
    const date = new Date(ts * 1000);
    return `Last heartbeat: ${date.toLocaleString('nl-NL', { hour12: false })}`;
  }

  private connect(url: string): void {
    this.disconnect();
    this.connected.set(false);
    this.streamError.set(null);

    if (!url) {
      this.streamError.set('No API URL configured for commander stream.');
      return;
    }

    this.disposeStream = this.commanderApi.openCommanderStream(url, {
      onOpen: () => {
        this.connected.set(true);
        this.streamError.set(null);
      },
      onError: (message) => {
        this.connected.set(false);
        this.streamError.set(message);
      },
      onEvent: (event) => {
        this.handleStreamEvent(event);
      },
    });
  }

  private disconnect(): void {
    if (this.disposeStream) {
      this.disposeStream();
      this.disposeStream = null;
    }
    this.connected.set(false);
  }

  private markHeartbeatPulse(): void {
    this.heartbeatPulse.set(true);
    if (this.heartbeatPulseTimer) {
      clearTimeout(this.heartbeatPulseTimer);
    }
    this.heartbeatPulseTimer = setTimeout(() => {
      this.heartbeatPulse.set(false);
      this.heartbeatPulseTimer = null;
    }, 500);
  }

  private handleStreamEvent(event: CommanderStreamEvent): void {
    if (event.type === 'heartbeat') {
      this.lastHeartbeatTs.set(typeof event.ts === 'number' ? event.ts : Date.now() / 1000);
      this.markHeartbeatPulse();
      if (!this.showHeartbeatLines()) {
        return;
      }
    }

    if (this.paused()) {
      return;
    }

    const line: ConsoleLine = {
      ts: typeof event.ts === 'number' ? event.ts : Date.now() / 1000,
      type: String(event.type || 'event'),
      text: this.toLineText(event),
      request_id: typeof event.request_id === 'string' ? event.request_id : undefined,
      seq: typeof event.seq === 'number' ? event.seq : undefined,
    };

    this.lines.update((current) => {
      const next = [...current, line];
      return next.length > 500 ? next.slice(next.length - 500) : next;
    });

    this.scrollToBottom();
  }

  private toLineText(event: CommanderStreamEvent): string {
    if (typeof event.line === 'string' && event.line.trim()) {
      return event.line;
    }
    return JSON.stringify(event);
  }

  private scrollToBottom(): void {
    if (!this.autoScroll()) {
      return;
    }
    setTimeout(() => {
      const el = this.consoleBody?.nativeElement;
      if (!el) {
        return;
      }
      el.scrollTop = el.scrollHeight;
    });
  }
}
