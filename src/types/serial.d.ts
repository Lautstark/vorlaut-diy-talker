/* WebSerial, which TypeScript's DOM library does not carry.
 *
 * It is a live standard rather than a shipped one, so the shapes live in
 * @types/w3c-web-serial instead of lib.dom. Declaring the four members
 * backend/cable.ts actually uses is smaller than a dependency, and honest in
 * the same way cdn.d.ts is honest about onnxruntime: what is written here is
 * what this page asks of the API, not a second description of the whole of it.
 *
 * If a browser has none of this, `navigator.serial` is undefined and the page
 * says so - that is Firefox and Safari, which edit boards perfectly well and
 * cannot talk to a cable. The declaration does not make the feature exist; it
 * only lets the one module that asks for it be type-checked.
 */

interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialPort {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
  /* Raising DTR alone is wanted; driving DTR and RTS together in sequence is
     how esptool drops an ESP32 into its bootloader. See docs/cable.md. */
  setSignals(signals: {
    dataTerminalReady?: boolean;
    requestToSend?: boolean;
  }): Promise<void>;
}

interface Serial {
  /** Ports already granted. No user gesture, so this may run on load. */
  getPorts(): Promise<SerialPort[]>;
  /** The picker. Needs transient activation, which expires in about five
   *  seconds - so it cannot be called after anything slow. */
  requestPort(options?: { filters?: SerialPortInfo[] }): Promise<SerialPort>;
  addEventListener(type: "connect" | "disconnect", run: () => void): void;
}

interface Navigator {
  readonly serial?: Serial;
}
