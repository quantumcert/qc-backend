// ═══════════════════════════════════════════════════════════
// QUANTUM CERT — PRISMA CLIENT SINGLETON (WITH ZERO-KNOWLEDGE EXTENSION)
// Prevents multiple PrismaClient instances and automatically handles
// Data-At-Rest AES-256-GCM Encryption for sensitive JSON blobs.
// ═══════════════════════════════════════════════════════════

import { PrismaClient, Prisma } from '@prisma/client';
import { CryptoService } from '../services/CryptoService';

const basePrisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development'
        ? ['query', 'warn', 'error']
        : ['error'],
});

// Zero-knowledge data-at-rest interceptor
const extendedPrisma = basePrisma.$extends({
    query: {
        asset: {
            async $allOperations({ operation, args, query }) {
                // Intercept WRITES
                if (['create', 'update', 'updateMany'].includes(operation as string)) {
                    if ((args as any).data?.metadata) {
                        (args as any).data.metadata = CryptoService.encryptJson((args as any).data.metadata);
                    }
                }

                // Execute normal query
                const result = await query(args);

                // Intercept READS
                if (['findUnique', 'findFirst', 'findMany'].includes(operation as string)) {
                    if (Array.isArray(result)) {
                        for (const item of result) {
                            if (item?.metadata) item.metadata = CryptoService.decryptJson(item.metadata);
                        }
                    } else if ((result as any)?.metadata) {
                        (result as any).metadata = CryptoService.decryptJson((result as any).metadata);
                    }
                }
                return result;
            },
        },
        eventLog: {
            async $allOperations({ operation, args, query }) {
                if (['create', 'update', 'updateMany'].includes(operation as string)) {
                    if ((args as any).data?.payload) {
                        (args as any).data.payload = CryptoService.encryptJson((args as any).data.payload);
                    }
                }

                const result = await query(args);

                if (['findUnique', 'findFirst', 'findMany'].includes(operation as string)) {
                    if (Array.isArray(result)) {
                        for (const item of result) {
                            if (item?.payload) item.payload = CryptoService.decryptJson(item.payload);
                        }
                    } else if ((result as any)?.payload) {
                        (result as any).payload = CryptoService.decryptJson((result as any).payload);
                    }
                }
                return result;
            },
        },
        blindContactLog: {
            async $allOperations({ operation, args, query }) {
                if (['create', 'update', 'updateMany'].includes(operation as string)) {
                    if ((args as any).data?.contactData) {
                        (args as any).data.contactData = CryptoService.encryptJson((args as any).data.contactData);
                    }
                }

                const result = await query(args);

                if (['findUnique', 'findFirst', 'findMany'].includes(operation as string)) {
                    if (Array.isArray(result)) {
                        for (const item of result) {
                            if (item?.contactData) item.contactData = CryptoService.decryptJson(item.contactData);
                        }
                    } else if ((result as any)?.contactData) {
                        (result as any).contactData = CryptoService.decryptJson((result as any).contactData);
                    }
                }
                return result;
            },
        }
    }
});

const globalForPrisma = globalThis as unknown as {
    prisma: typeof extendedPrisma | undefined;
};

export const prisma = globalForPrisma.prisma ?? extendedPrisma;

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

export default prisma;
