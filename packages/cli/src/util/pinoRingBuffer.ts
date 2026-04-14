export interface LogEvent {
  time: number;
  level: number;
  service?: string;
  msg: string;
  [k: string]: unknown;
}

export class PinoRingBuffer {
  private buf: LogEvent[] = [];
  constructor(private readonly cap: number) {}
  push(e: LogEvent): void {
    this.buf.push(e);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  snapshot(): readonly LogEvent[] {
    return this.buf;
  }
}
