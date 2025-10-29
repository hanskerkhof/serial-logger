import {Subscription} from 'rxjs';
import {Component, ElementRef, ViewChild, HostListener, OnInit, OnDestroy, AfterViewInit} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {SerialService} from './serial.service';
import { HistoryService } from './history.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.css'],
})
export class AppComponent implements OnInit, OnDestroy {
  title = 'Serial Logger';
  log = '';
  baud = 115200; // default
  inputText: string = '';


  // 1) reference to the <input #cmdInput … class="command-input">
  @ViewChild('cmdInput') cmdInput!: ElementRef<HTMLInputElement>;

  ngAfterViewInit(): void {
    // initial autofocus once the view is ready
    setTimeout(() => this.focusCmd(), 0);
  }

  /** Focus the command input and place caret at end */
  private focusCmd() {
    const el = this.cmdInput?.nativeElement;
    console.log("focusCmd el:", el);
    if (!el) return;
    if (document.activeElement !== el) {
      console.log("el.focus():", el);
      el.focus();
    }
    const v = el.value ?? '';
    el.setSelectionRange(v.length, v.length);
  }

  /** Insert text at the current caret position (and sync ngModel) */
  private insertTextAtCaret(text: string) {
    const el = this.cmdInput.nativeElement;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    const next = before + text + after;
    el.value = next;
    // keep your [(ngModel)] bound value in sync if you use it
    (this as any).inputText = next;
    const caret = (before + text).length;
    el.setSelectionRange(caret, caret);
  }

  /** True if event originated in the command input or any genuinely editable element */
  private isFromEditableTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    if (!el) return false;

    // 1) your command input
    if (el.tagName === 'INPUT') {
      const inp = el as HTMLInputElement;
      return !inp.readOnly && !inp.disabled;
    }

    // 2) any contenteditable ancestor explicitly set to true
    if (el.closest?.('[contenteditable="true"]')) return true;

    return false; // textarea/log stays non-editable for routing paste/typing
  }

  // /** True if the event target is from the input control */
  // private isFromEditableTarget(t: EventTarget | null): boolean {
  //   const el = t as HTMLElement | null;
  //   return !!el && (el.tagName === 'INPUT' || (el as any).isContentEditable);
  // }

  // 2a) Type anywhere → focus the command input (no lost first character)
  @HostListener('document:keydown', ['$event'])
  onDocKeydown(ev: KeyboardEvent) {
    // let shortcuts work (Cmd/Ctrl/Alt)
    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    // if user already typing in an input/textarea, do nothing
    if (this.isFromEditableTarget(ev.target)) return;

    const printable = ev.key.length === 1;
    const backspace = ev.key === 'Backspace';

    if (printable || backspace) {
      ev.preventDefault();
      this.focusCmd();

      if (backspace) {
        // Simulate backspace on the command input
        const el = this.cmdInput.nativeElement;
        const start = el.selectionStart ?? el.value.length;
        const end = el.selectionEnd ?? el.value.length;
        if (start === end && start > 0) {
          el.setSelectionRange(start - 1, end);
        }
        document.execCommand?.('delete'); // best-effort for older engines
        (this as any).inputText = el.value; // sync model
      } else {
        this.insertTextAtCaret(ev.key);
      }
    }
  }

  // 2b) Paste anywhere → focus the command input and paste there
  @HostListener('document:paste', ['$event'])
  onDocPaste(ev: ClipboardEvent) {
    console.log("ClipboardEvent" + ev);
    if (this.isFromEditableTarget(ev.target)) {
      console.log('isFromEditableTarget', ev.target);
      return; // normal paste
    }

    const text = ev.clipboardData?.getData('text');
    console.log("getData" + text);
    if (!text) return;

    ev.preventDefault();
    console.log("call focusCmd");
    this.focusCmd();
    this.insertTextAtCaret(text);
  }

  // --- YOUR EXISTING METHODS BELOW ---
  // If you have a send method, just re-focus after sending:


  // Add command history tracking
  commandHistory: string[] = [];
  historyIndex = -1;
  tempInputBeforeHistory = '';

  private subs: Subscription[] = [];

  constructor(public serial: SerialService, private history: HistoryService) {}

  ngOnInit() {
    this.subs.push(
      this.serial.log$.subscribe(chunk => {
        this.log += chunk; // append raw chunk
        // Optional: keep the last N KB
        if (this.log.length > 500000) this.log = this.log.slice(-250000);
        // Scroll tail
        queueMicrotask(() => {
          const ta = document.getElementById('logArea');
          if (ta) ta.scrollTop = ta.scrollHeight;
        });
      })
    );

    // ⬇️ load persisted history
    this.commandHistory = this.history.load();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  async connect() {
    try {
      await this.serial.requestAndConnect(this.baud);
    } catch (e: any) {
      alert(e?.message || e);
    }
  }

  async disconnect() {
    await this.serial.disconnect();
  }

  async quickConnect() {
    // Tries previously authorized ports first (no chooser).
    if (!('serial' in navigator)) return alert('Web Serial not supported');
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return this.connect(); // fallback to chooser
    try {
      await this.serial.openPort(ports[0], this.baud);
    } catch (e: any) {
      alert(e?.message || e);
    }
  }

  async sendLine() {
    const text = this.inputText.endsWith('\n') ? this.inputText : this.inputText + '\n';
    try {
      await this.serial.send(text);

      // Add command to history if not empty and not a duplicate of the most recent command
      const trimmedText = this.inputText.trim();
      if (trimmedText && (this.commandHistory.length === 0 || this.commandHistory[0] !== trimmedText)) {
        this.commandHistory.unshift(trimmedText); // Add to beginning of array

        // ⬇️ persist & sync local array (push to front, dedupe, limit 50)
        this.commandHistory = this.history.pushFront(trimmedText,
          { dedupeHead: true, max: 50 });

        // Optionally limit history size
        if (this.commandHistory.length > 50) {
          this.commandHistory.pop();
        }
      }

      this.inputText = '';
      this.historyIndex = -1; // Reset history index after sending
    } catch (e: any) {
      alert(e?.message || e);
    }
  }

  clearLog() {
    this.log = '';
  }

  // --- v3
  // --- History UI helpers ---
  clearHistoryAll() {
    if (!confirm('Clear all saved commands?')) return;
    this.history.clear();
    this.commandHistory = [];
  }

  // Native <dialog> reference
  @ViewChild('historyDialog') historyDialog!: ElementRef<HTMLDialogElement>;

  openHistoryDialog() {
    this.commandHistory = this.history.load(); // refresh from storage
    this.historyDialog?.nativeElement?.showModal();
  }

  closeHistoryDialog() {
    this.historyDialog?.nativeElement?.close();
  }

  reuseHistoryItem(cmd: string) {
    this.inputText = cmd;
    this.closeHistoryDialog();
    // bring caret to end and focus
    setTimeout(() => this.focusCmd(), 0);
  }

  // async reuseAndSend(cmd: string) {
  //   this.inputText = cmd;
  //   this.closeHistoryDialog?.();
  //   try {
  //     await this.sendLine();          // ✅ handle the promise
  //   } finally {
  //     setTimeout(() => this['focusCmd']?.(), 0);
  //   }
  // }

  reuseAndSend(cmd: string) {
    this.inputText = cmd;
    this.closeHistoryDialog?.();
    this.sendLine()                   // ✅ handle the promise
      .finally(() => setTimeout(() => this['focusCmd']?.(), 0));
  }

  // reuseAndSend(cmd: string) {
  //   this.inputText = cmd;
  //   // Optionally close the dialog before sending to avoid double submit clicks
  //   this.closeHistoryDialog?.();
  //   // Send immediately; sendLine already appends newline, updates history, and resets the field
  //   void this.sendLine();             // ✅ explicit ignore
  //   // this.sendLine();
  //   // Re-focus input for rapid follow-ups
  //   setTimeout(() => this['focusCmd']?.(), 0);
  // }

  deleteHistoryAt(i: number) {
    this.commandHistory = this.history.deleteAt(i);
  }
  // ^^^ v3

  // Handle up/down arrow keys for history navigation
  handleKeyDown(event: KeyboardEvent) {
    if (event.key === 'ArrowUp') {
      event.preventDefault(); // Prevent cursor from moving to start of input

      // If this is the first arrow press, store current input
      if (this.historyIndex === -1) {
        this.tempInputBeforeHistory = this.inputText;
      }

      // Navigate up in history if possible
      if (this.historyIndex < this.commandHistory.length - 1) {
        this.historyIndex++;
        this.inputText = this.commandHistory[this.historyIndex];
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault(); // Prevent cursor from moving to end of input

      if (this.historyIndex > 0) {
        // Navigate down in history
        this.historyIndex--;
        this.inputText = this.commandHistory[this.historyIndex];
      } else if (this.historyIndex === 0) {
        // Return to the original input text if we're at the beginning of history
        this.historyIndex = -1;
        this.inputText = this.tempInputBeforeHistory;
      }
    }
  }
}
