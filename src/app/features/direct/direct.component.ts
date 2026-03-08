import { Subscription } from 'rxjs';
import {
  Component,
  ElementRef,
  ViewChild,
  HostListener,
  OnInit,
  OnDestroy,
  AfterViewInit,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SerialService } from '../../serial.service';
import { HistoryService } from '../../history.service';

@Component({
  selector: 'app-direct',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './direct.component.html',
  styleUrls: ['./direct.component.scss'],
})
export class DirectComponent implements OnInit, OnDestroy, AfterViewInit {
  title = 'Serial Logger';
  log = '';
  baud = 115200;
  inputText = '';

  @ViewChild('cmdInput') cmdInput!: ElementRef<HTMLInputElement>;
  @ViewChild('historyDialog') historyDialog!: ElementRef<HTMLDialogElement>;

  commandHistory: string[] = [];
  historyIndex = -1;
  tempInputBeforeHistory = '';
  private subs: Subscription[] = [];

  constructor(
    public serial: SerialService,
    private history: HistoryService,
  ) {}

  ngAfterViewInit(): void {
    setTimeout(() => this.focusCmd(), 0);
  }

  ngOnInit(): void {
    this.subs.push(
      this.serial.log$.subscribe((chunk) => {
        this.log += chunk;
        if (this.log.length > 500000) this.log = this.log.slice(-250000);
        queueMicrotask(() => {
          const ta = document.getElementById('logArea');
          if (ta) ta.scrollTop = ta.scrollHeight;
        });
      }),
    );

    this.commandHistory = this.history.load();
  }

  ngOnDestroy(): void {
    this.subs.forEach((s) => s.unsubscribe());
  }

  @HostListener('document:keydown', ['$event'])
  onDocKeydown(ev: KeyboardEvent): void {
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;
    if (this.isFromEditableTarget(ev.target)) return;

    const printable = ev.key.length === 1;
    const backspace = ev.key === 'Backspace';

    if (printable || backspace) {
      ev.preventDefault();
      this.focusCmd();

      if (backspace) {
        const el = this.cmdInput.nativeElement;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        if (start === end && start > 0) {
          el.setSelectionRange(start - 1, end);
        }
        document.execCommand?.('delete');
        this.inputText = el.value;
      } else {
        this.insertTextAtCaret(ev.key);
      }
    }
  }

  @HostListener('document:paste', ['$event'])
  onDocPaste(ev: ClipboardEvent): void {
    if (this.isFromEditableTarget(ev.target)) return;

    const text = ev.clipboardData?.getData('text');
    if (!text) return;

    ev.preventDefault();
    this.focusCmd();
    this.insertTextAtCaret(text);
  }

  async connect(): Promise<void> {
    try {
      await this.serial.requestAndConnect(this.baud);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async disconnect(): Promise<void> {
    await this.serial.disconnect();
  }

  async quickConnect(): Promise<void> {
    if (!('serial' in navigator)) {
      alert('Web Serial not supported');
      return;
    }
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return this.connect();
    try {
      await this.serial.openPort(ports[0], this.baud);
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  async sendLine(): Promise<void> {
    const text = this.inputText.endsWith('\n') ? this.inputText : this.inputText + '\n';
    try {
      await this.serial.send(text);

      const trimmedText = this.inputText.trim();
      if (trimmedText && (this.commandHistory.length === 0 || this.commandHistory[0] !== trimmedText)) {
        this.commandHistory = this.history.pushFront(trimmedText, {
          dedupeHead: true,
          max: 50,
        });
      }

      this.inputText = '';
      this.historyIndex = -1;
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : String(e));
    }
  }

  clearHistoryAll(): void {
    if (!confirm('Clear all saved commands?')) return;
    this.history.clear();
    this.commandHistory = [];
  }

  openHistoryDialog(): void {
    this.commandHistory = this.history.load();
    this.historyDialog?.nativeElement?.showModal();
  }

  closeHistoryDialog(): void {
    this.historyDialog?.nativeElement?.close();
  }

  reuseHistoryItem(cmd: string): void {
    this.inputText = cmd;
    this.closeHistoryDialog();
    setTimeout(() => this.focusCmd(), 0);
  }

  reuseAndSend(cmd: string): void {
    this.inputText = cmd;
    this.closeHistoryDialog?.();
    void this.sendLine();
    setTimeout(() => this.focusCmd(), 0);
  }

  deleteHistoryAt(i: number): void {
    this.commandHistory = this.history.deleteAt(i);
  }

  handleKeyDown(event: KeyboardEvent): void {
    if (event.key === 'ArrowUp') {
      event.preventDefault();

      if (this.historyIndex === -1) {
        this.tempInputBeforeHistory = this.inputText;
      }

      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.inputText = this.commandHistory[this.historyIndex];
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();

      if (this.historyIndex > 0) {
        this.historyIndex--;
        this.inputText = this.commandHistory[this.historyIndex];
      } else if (this.historyIndex === 0) {
        this.historyIndex = -1;
        this.inputText = this.tempInputBeforeHistory;
      }
    }
  }

  private focusCmd(): void {
    const el = this.cmdInput?.nativeElement;
    if (!el) return;
    if (document.activeElement !== el) {
      try {
        el.focus({ preventScroll: true });
      } catch {
        el.focus();
      }
    }
    const v = el.value ?? '';
    el.setSelectionRange(v.length, v.length);
  }

  private insertTextAtCaret(text: string): void {
    const el = this.cmdInput.nativeElement;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = before + text + after;
    el.value = next;
    this.inputText = next;
    const caret = (before + text).length;
    el.setSelectionRange(caret, caret);
  }

  private isFromEditableTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;

    if (el.tagName === 'INPUT') {
      const inp = el as HTMLInputElement;
      return !inp.readOnly && !inp.disabled;
    }

    return !!el.closest?.('[contenteditable="true"]');
  }
}
