// src/app/serial.service.ts
import { Injectable, NgZone, OnDestroy } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class SerialService implements OnDestroy {
  /** The active serial port connection */
  private port: SerialPort | null = null;

  /** Reader for incoming data */
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  /** Writer for outgoing data */
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;

  /** UTF-8 decoder for converting binary data to text */
  private decoder = new TextDecoder();

  /** UTF-8 encoder for converting text to binary data */
  private encoder = new TextEncoder();

  /** Whether the Web Serial API is available in this browser */
  readonly isSupported = typeof (navigator as any).serial !== 'undefined';

  /** Observable indicating whether a serial connection is active */
  readonly connected$ = new BehaviorSubject<boolean>(false);

  /** Current baud rate of the connection */
  readonly baud$ = new BehaviorSubject<number>(115200);

  /** Stream of decoded text from the serial connection */
  readonly log$ = new Subject<string>();

  /** True if previously paired ports are available */
  readonly pairedPortsAvailable$ = new BehaviorSubject<boolean>(false);

  constructor(private zone: NgZone) {
    if (this.isSupported) {
      navigator.serial.addEventListener('disconnect', this.handleDisconnect);

      // Check for paired ports initially and update state
      this.checkPairedPorts();
    }
  }

  ngOnDestroy(): void {
    // Clean up when service is destroyed
    if (this.isSupported) {
      navigator.serial.removeEventListener('disconnect', this.handleDisconnect);
    }

    void this.disconnect();
  }

  /**
   * Check if previously paired ports are available
   */
  async checkPairedPorts(): Promise<void> {
    if (!this.isSupported) return;

    try {
      const ports = await navigator.serial.getPorts();
      this.pairedPortsAvailable$.next(ports.length > 0);
    } catch (err) {
      console.error('Error checking paired ports:', err);
      this.pairedPortsAvailable$.next(false);
    }
  }

  /**
   * Show the browser's port selection dialog and connect to the selected port
   * @param baud The baud rate to use (default: 115,200)
   * @returns Promise that resolves when connected
   */
  async requestAndConnect(baud = 115200): Promise<void> {
    if (!this.isSupported) throw new Error('Web Serial API not supported in this browser.');
    const port = await navigator.serial.requestPort();
    await this.openPort(port, baud);
  }

  /**
   * Try to connect to a previously authorized port without showing the port selection dialog
   * Falls back to showing the dialog if no previously authorized ports are available
   * @param baud The baud rate to use (default: 115,200)
   * @returns Promise that resolves when connected
   */
  async quickConnect(baud = 115200): Promise<void> {
    if (!this.isSupported) throw new Error('Web Serial API not supported in this browser.');
    const ports = await navigator.serial.getPorts();
    if (ports.length === 0) return this.requestAndConnect(baud);
    await this.openPort(ports[0], baud);
  }

  /**
   * Open a specific serial port with the given baud rate
   * @param port The serial port to open
   * @param baud The baud rate to use (default: 115200)
   * @returns Promise that resolves when connected
   */
  async openPort(port: SerialPort, baud = 115200): Promise<void> {
    // Close any existing connection first
    await this.disconnect();

    try {
      await port.open({ baudRate: baud });
      this.port = port;
      this.baud$.next(baud);

      const readable = port.readable;
      const writable = port.writable;

      if (!readable || !writable) {
        await this.disconnect();
        throw new Error('Selected serial port is not readable/writable.');
      }

      // Get writer for sending Uint8Array data
      this.writer = writable.getWriter();

      // Start read loop for incoming data
      this.reader = readable.getReader();
      this.connected$.next(true);

      // Start the read loop (arrow function preserves 'this')
      void this.readLoop();
    } catch (err) {
      // Clean up in case of error during connection
      await this.disconnect();
      throw new Error(`Failed to open serial port: ${String(err)}`);
    }
  }

  /**
   * Read loop that processes incoming data until disconnected
   * Decodes binary data to UTF-8 text and emits it to log$
   */
  private readLoop = async (): Promise<void> => {
    if (!this.reader) return;

    try {
      for (;;) {
        const { value, done } = await this.reader.read();
        if (done) break;

        if (value && value.length) {
          // Decode binary data to text (with streaming support)
          const text = this.decoder.decode(value, { stream: true });
          if (text) {
            // Run within Angular zone to ensure UI updates
            this.zone.run(() => this.log$.next(text));
          }
        }
      }
    } catch (err) {
      this.zone.run(() => this.log$.next(`\n[read error] ${String(err)}\n`));
    } finally {
      // Flush any remaining bytes in the decoder buffer
      const tail = this.decoder.decode();
      if (tail) this.zone.run(() => this.log$.next(tail));

      // Clean up reader
      try { this.reader?.releaseLock(); } catch {}
      this.reader = null;

      // Fully disconnect (port is likely closed if we get here)
      await this.disconnect();
    }
  };

  /**
   * Send text data over the serial connection
   * @param text The text to send (encoded as UTF-8)
   * @returns Promise that resolves when data is sent
   */
  async send(text: string): Promise<void> {
    if (!this.writer) throw new Error('Not connected to a serial port.');

    // Convert text to Uint8Array using UTF-8 encoding
    const data = this.encoder.encode(text);

    try {
      await this.writer.write(data);
    } catch (err) {
      // If writing fails, disconnect and throw
      await this.disconnect();
      throw new Error(`Failed to send data: ${String(err)}`);
    }
  }

  /**
   * Disconnect from the serial port and clean up resources
   * @returns Promise that resolves when disconnected
   */
  async disconnect(): Promise<void> {
    // Stop reading
    try { await this.reader?.cancel(); } catch {}
    try { this.reader?.releaseLock(); } catch {}
    this.reader = null;

    // Stop writing
    try { await this.writer?.close(); } catch {}
    try { this.writer?.releaseLock(); } catch {}
    this.writer = null;

    // Close port
    if (this.port) {
      try { await this.port.close(); } catch {}
    }
    this.port = null;

    // After disconnecting, check for paired ports again
    await this.checkPairedPorts();

    // Update connection state
    if (this.connected$.value) this.connected$.next(false);
  }

  /**
   * Handler for the browser's serial port disconnect event
   */
  handleDisconnect = (): void => {
    this.log$.next('\n[device disconnected]\n');
    void this.disconnect();
  };
}
