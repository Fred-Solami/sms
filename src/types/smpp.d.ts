declare module 'smpp' {
  import { EventEmitter } from 'events';
  import * as net from 'net';

  export interface SMPPSession extends EventEmitter {
    system_id?: string;
    socket?: net.Socket;
    bind_transceiver(params: any, callback: (pdu: any) => void): void;
    submit_sm(params: any, callback?: (pdu: any) => void): void;
    deliver_sm(params: any, callback?: (pdu: any) => void): void;
    deliver_sm_resp(params: any): void;
    unbind(callback?: () => void): void;
    unbind_resp(): void;
    send(pdu: any): void;
    close(): void;
  }

  export interface SMPPServer extends EventEmitter {
    listen(port: number, host: string, callback?: () => void): this;
    close(callback?: () => void): void;
  }

  export function connect(config: any, callback?: () => void): SMPPSession;
  export function createServer(sessionHandler: (session: SMPPSession) => void): SMPPServer;
}
