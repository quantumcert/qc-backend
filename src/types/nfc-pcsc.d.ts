/**
 * Type declarations for nfc-pcsc
 * 
 * nfc-pcsc is an optional hardware dependency for NFC reader communication.
 * It may not be installed in all environments (e.g., CI, cloud, Docker).
 */
declare module 'nfc-pcsc' {
    import { EventEmitter } from 'events';

    interface Card {
        uid: string;
        atr: Buffer;
        standard: string;
        type: string;
    }

    interface Reader extends EventEmitter {
        name: string;
        transmit(data: Buffer, responseMaxLength: number): Promise<Buffer>;
        close(): void;
    }

    class NFC extends EventEmitter {
        constructor();
        close(): void;
    }

    export default NFC;
    export { NFC, Reader, Card };
}
