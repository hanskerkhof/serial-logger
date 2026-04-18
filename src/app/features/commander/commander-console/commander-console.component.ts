import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  ViewChild,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { CommanderApiService, CommanderStreamEvent, OtaStreamEvent } from '../../../commander-api.service';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { ToggleSwitchModule } from 'primeng/toggleswitch';

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
  imports: [NgClass, ButtonModule, ToggleSwitchModule, FormsModule],
  templateUrl: './commander-console.component.html',
  styleUrl: './commander-console.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommanderConsoleComponent {
  apiBaseUrl = input.required<string>();
  readonly otaProgress = output<OtaStreamEvent>();
  readonly otaComplete = output<OtaStreamEvent>();
  readonly otaError = output<OtaStreamEvent>();

  protected readonly connected = signal(false);
  protected readonly streamError = signal<string | null>(null);
  protected readonly paused = signal(false);
  protected readonly autoScroll = signal(true);
  protected readonly showHeartbeatLines = signal(false);
  protected readonly showPassiveSeenLines = signal(false);
  protected readonly showCommandStartLines = signal(false);
  protected readonly heartbeatPulse = signal(false);
  protected readonly lastHeartbeatTs = signal<number | null>(null);
  protected readonly lines = signal<ConsoleLine[]>([]);

  @ViewChild('consoleBody') private consoleBody?: ElementRef<HTMLElement>;

  private readonly commanderApi = inject(CommanderApiService);
  private readonly destroyRef = inject(DestroyRef);
  private disposeStream: (() => void) | null = null;
  private heartbeatPulseTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryDelayMs = 3_000;
  private static readonly INITIAL_RETRY_MS = 3_000;
  private static readonly MAX_RETRY_MS = 30_000;

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

  protected togglePassiveSeenLines(): void {
    this.showPassiveSeenLines.set(!this.showPassiveSeenLines());
  }

  protected toggleCommandStartLines(): void {
    this.showCommandStartLines.set(!this.showCommandStartLines());
  }

  protected clear(): void {
    this.lines.set([]);
  }

  protected retry(): void {
    this.retryDelayMs = CommanderConsoleComponent.INITIAL_RETRY_MS; // Reset backoff on manual retry
    this.connect(this.apiBaseUrl());
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
        this.retryDelayMs = CommanderConsoleComponent.INITIAL_RETRY_MS; // Reset backoff
      },
      onError: (message) => {
        this.connected.set(false);
        this.streamError.set(message);
        // Close the EventSource immediately so the browser doesn't also retry
        // independently. We schedule our own reconnect with exponential backoff.
        this.disconnect();
        this.scheduleReconnect(url);
      },
      onEvent: (event) => {
        this.handleStreamEvent(event);
      },
      ota_progress: (event) => this.otaProgress.emit(event),
      ota_complete: (event) => this.otaComplete.emit(event),
      ota_error: (event) => this.otaError.emit(event),
    });
  }

  private scheduleReconnect(url: string): void {
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.connect(url);
    }, this.retryDelayMs);
    this.retryDelayMs = Math.min(
      this.retryDelayMs * 2,
      CommanderConsoleComponent.MAX_RETRY_MS,
    );
  }

  private disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
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

    if (!this.showPassiveSeenLines() && typeof event.line === 'string' && event.line.includes('BK_PASSIVE_SEEN')) {
      return;
    }

    const isTransportCommandLifecycleEvent =
      event.type === 'command_start' ||
      event.type === 'command_done' ||
      event.type === 'command_error';
    if (!this.showCommandStartLines() && isTransportCommandLifecycleEvent) {
      return;
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

  protected lineStateClass(type: string): string {
    switch (type) {
      case 'commander_online':
      case 'commander_port_changed':
        return 'commander-console__line--state-online';
      case 'commander_offline':
      case 'commander_invalid_device':
        return 'commander-console__line--state-offline';
      case 'commander_reconnecting':
        return 'commander-console__line--state-reconnecting';
      case 'commander_probing':
        return 'commander-console__line--state-probing';
      case 'commander_state':
        return 'commander-console__line--state-generic';
      default:
        return '';
    }
  }

  private toLineText(event: CommanderStreamEvent): string {
    if (typeof event.line === 'string' && event.line.trim()) {
      return event.line;
    }
    switch (event.type) {
      case 'commander_online':
        return `Serial online: ${event['port'] ?? '?'} @ ${event['baud'] ?? '?'}`;
      case 'commander_offline':
        return `Serial offline — reason: ${event['reason'] ?? 'unknown'}`;
      case 'commander_probing':
        return `Probing serial port...`;
      case 'commander_reconnecting':
        return `Reconnecting — reason: ${event['reason'] ?? 'unknown'}`;
      case 'commander_invalid_device':
        return `Invalid device: ${event['port'] ?? '?'}`;
      case 'commander_port_changed':
        return `Port changed → ${event['port'] ?? '?'}`;
      case 'commander_state':
        return `State: ${event['state'] ?? '?'}${event['reason'] ? ` (${event['reason']})` : ''}`;
      default:
        return JSON.stringify(event);
    }
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
