import prisma from '../../config/prisma';
import { createHash } from 'crypto';
import {
    CreditLedgerEntryType,
    MigrationMode,
    MigrationRecordStatus,
    MigrationRunStatus,
    Prisma,
    QTagLedgerEntryType,
} from '@prisma/client';
import { TenantUserFacet } from './TenantUserFacet';
import { CreditLedgerFacet } from './CreditLedgerFacet';
import { AdminActorContext, DiamondFacets, ResourceTypes } from '../../types';

export type DashboardUserSource = {
    id: number | string;
    openId?: string | null;
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    cpf?: string | null;
    role?: string | null;
    guardianId?: number | string | null;
    dateOfBirth?: string | null;
    relation?: string | null;
    emergencyContactName?: string | null;
    emergencyContactPhone?: string | null;
    bloodType?: string | null;
    allergies?: string | null;
    metadata?: string | Record<string, unknown> | null;
    creditsBalance?: number | null;
    qtagsBalance?: number | null;
    createdAt?: string | Date | null;
    updatedAt?: string | Date | null;
};

export type TenantQuantumBackfillParams = {
    mode: MigrationMode;
    users: DashboardUserSource[];
    batchSize?: number;
    resumeRunId?: string;
    actor?: AdminActorContext;
    source?: string;
};

export type TenantQuantumBackfillReport = {
    runId: string;
    tenantId: string;
    mode: MigrationMode;
    status: MigrationRunStatus;
    source: string;
    batchSize: number;
    sourceCount: number;
    migratedCount: number;
    skippedCount: number;
    conflictCount: number;
    errorCount: number;
    warnings: string[];
    conflicts: Array<{ sourceId: string; reason: string }>;
    records: Array<{
        sourceId: string;
        targetId?: string | null;
        status: MigrationRecordStatus;
        warnings: string[];
        error?: string | null;
    }>;
};

const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_SOURCE = 'qc-dashboard.users';

export class TenantQuantumBackfillFacet {
    static async dryRun(params: Omit<TenantQuantumBackfillParams, 'mode'>) {
        return this.run({ ...params, mode: MigrationMode.DRY_RUN });
    }

    static async execute(params: Omit<TenantQuantumBackfillParams, 'mode'>) {
        return this.run({ ...params, mode: MigrationMode.EXECUTE });
    }

    static async run(params: TenantQuantumBackfillParams): Promise<TenantQuantumBackfillReport> {
        const tenant = await TenantUserFacet.ensureTenantQuantum();
        const source = params.source || DEFAULT_SOURCE;
        const batchSize = normalizeBatchSize(params.batchSize);
        const users = [...params.users].sort(compareSourceUsers);
        const checksum = checksumJson(users.map(toChecksumUser));
        const duplicateDocuments = findDuplicateDocuments(users);

        const run = params.resumeRunId
            ? await prisma.migrationRun.update({
                where: { id: params.resumeRunId },
                data: {
                    status: MigrationRunStatus.RUNNING,
                    error: null,
                },
            })
            : await prisma.migrationRun.create({
                data: {
                    tenantId: tenant.id,
                    mode: params.mode,
                    source,
                    status: MigrationRunStatus.RUNNING,
                    batchSize,
                    checksum,
                    summary: {
                        facet: DiamondFacets.TENANT_QUANTUM_BACKFILL,
                        sourceCount: users.length,
                    },
                    createdByActorId: params.actor?.actorUserId,
                },
            });

        const report: TenantQuantumBackfillReport = {
            runId: run.id,
            tenantId: tenant.id,
            mode: params.mode,
            status: MigrationRunStatus.RUNNING,
            source,
            batchSize,
            sourceCount: users.length,
            migratedCount: 0,
            skippedCount: 0,
            conflictCount: 0,
            errorCount: 0,
            warnings: [],
            conflicts: [],
            records: [],
        };

        try {
            for (let index = 0; index < users.length; index += batchSize) {
                const batch = users.slice(index, index + batchSize);
                const batchKey = `${source}:${index + 1}-${index + batch.length}`;

                await prisma.migrationCheckpoint.upsert({
                    where: {
                        migrationRunId_batchKey: {
                            migrationRunId: run.id,
                            batchKey,
                        },
                    },
                    create: {
                        tenantId: tenant.id,
                        migrationRunId: run.id,
                        source,
                        batchKey,
                        lastSourceId: String(batch[batch.length - 1]?.id ?? ''),
                        processedCount: 0,
                        checksum: checksumJson(batch.map(toChecksumUser)),
                        status: MigrationRunStatus.RUNNING,
                        metadata: { startIndex: index, batchLength: batch.length },
                    },
                    update: {
                        lastSourceId: String(batch[batch.length - 1]?.id ?? ''),
                        status: MigrationRunStatus.RUNNING,
                    },
                });

                let processedCount = 0;
                for (const user of batch) {
                    const record = await this.processUser({
                        tenantId: tenant.id,
                        migrationRunId: run.id,
                        mode: params.mode,
                        source,
                        user,
                        duplicateDocuments,
                    });
                    processedCount += 1;
                    report.records.push(record);

                    if (record.status === MigrationRecordStatus.MIGRATED) report.migratedCount += 1;
                    if (record.status === MigrationRecordStatus.SKIPPED) report.skippedCount += 1;
                    if (record.status === MigrationRecordStatus.CONFLICT) {
                        report.conflictCount += 1;
                        report.conflicts.push({
                            sourceId: record.sourceId,
                            reason: record.error || 'Conflito de migração.',
                        });
                    }
                    if (record.status === MigrationRecordStatus.ERROR) report.errorCount += 1;
                    report.warnings.push(...record.warnings);
                }

                await prisma.migrationCheckpoint.update({
                    where: {
                        migrationRunId_batchKey: {
                            migrationRunId: run.id,
                            batchKey,
                        },
                    },
                    data: {
                        processedCount,
                        status: MigrationRunStatus.COMPLETED,
                    },
                });
            }

            report.status = report.errorCount > 0
                ? MigrationRunStatus.FAILED
                : MigrationRunStatus.COMPLETED;

            await prisma.migrationRun.update({
                where: { id: run.id },
                data: {
                    status: report.status,
                    completedAt: new Date(),
                    summary: buildRunSummary(report),
                    error: report.status === MigrationRunStatus.FAILED
                        ? 'Backfill completed with record errors.'
                        : null,
                },
            });

            return report;
        } catch (error) {
            await prisma.migrationRun.update({
                where: { id: run.id },
                data: {
                    status: MigrationRunStatus.FAILED,
                    error: error instanceof Error ? error.message : 'Unknown migration error.',
                    summary: buildRunSummary(report),
                    completedAt: new Date(),
                },
            });
            throw error;
        }
    }

    private static async processUser(params: {
        tenantId: string;
        migrationRunId: string;
        mode: MigrationMode;
        source: string;
        user: DashboardUserSource;
        duplicateDocuments: Set<string>;
    }) {
        const sourceId = String(params.user.id);
        const warnings: string[] = [];
        const document = normalizeDocument(params.user.cpf);

        if (document && params.duplicateDocuments.has(document)) {
            return this.writeRecord({
                ...params,
                sourceId,
                status: MigrationRecordStatus.CONFLICT,
                error: 'CPF duplicado na origem do dashboard.',
                warnings,
            });
        }

        if (!params.user.openId && !params.user.email && !document) {
            return this.writeRecord({
                ...params,
                sourceId,
                status: MigrationRecordStatus.CONFLICT,
                error: 'Usuário sem openId, email ou CPF seguro para upsert.',
                warnings,
            });
        }

        if (!Number.isInteger(params.user.creditsBalance) || Number(params.user.creditsBalance ?? 0) < 0) {
            warnings.push('Sem fonte durável de creditsBalance positiva; crédito não migrado.');
        }
        if (!Number.isInteger(params.user.qtagsBalance) || Number(params.user.qtagsBalance ?? 0) < 0) {
            warnings.push('Sem fonte durável de saldo QTAG positiva; saldo QTAG não migrado.');
        }

        if (params.mode === MigrationMode.DRY_RUN) {
            return this.writeRecord({
                ...params,
                sourceId,
                status: MigrationRecordStatus.SKIPPED,
                warnings,
                metadata: {
                    dryRun: true,
                    wouldUpsertTenantUser: true,
                    wouldReconcileOwnerRefs: Boolean(params.user.openId || params.user.email || document),
                    wouldMigrateCredits: Number(params.user.creditsBalance ?? 0) > 0,
                    wouldMigrateQTags: Number(params.user.qtagsBalance ?? 0) > 0,
                },
            });
        }

        try {
            const tenantUser = await TenantUserFacet.upsertB2CUser({
                tenantId: params.tenantId,
                legacyDashboardUserId: params.user.id,
                legacyOpenId: params.user.openId,
                email: params.user.email,
                phone: params.user.phone,
                cpf: params.user.cpf,
                displayName: params.user.name,
                guardianLegacyDashboardUserId: params.user.guardianId,
                profile: buildProfile(params.user),
                metadata: buildMetadata(params.user),
                migratedAt: new Date(),
                source: params.source,
            });

            await prisma.$transaction(async (tx) => {
                const ownerUpdateCount = await this.reconcileOwnerRefs(tx, params.tenantId, params.user, tenantUser.id);
                const creditEntryId = await this.migrateCredits(tx, params.tenantId, params.user, tenantUser.id);
                const qtagEntryId = await this.migrateQTags(tx, params.tenantId, params.user, tenantUser.id);

                await this.writeRecord({
                    ...params,
                    sourceId,
                    targetId: tenantUser.id,
                    status: MigrationRecordStatus.MIGRATED,
                    warnings,
                    metadata: {
                        ownerUpdateCount,
                        creditEntryId,
                        qtagEntryId,
                    },
                    tx,
                });
            });

            return {
                sourceId,
                targetId: tenantUser.id,
                status: MigrationRecordStatus.MIGRATED,
                warnings,
                error: null,
            };
        } catch (error) {
            return this.writeRecord({
                ...params,
                sourceId,
                status: MigrationRecordStatus.ERROR,
                error: error instanceof Error ? error.message : 'Erro desconhecido ao migrar usuário.',
                warnings,
            });
        }
    }

    private static async writeRecord(params: {
        tenantId: string;
        migrationRunId: string;
        mode: MigrationMode;
        source: string;
        user: DashboardUserSource;
        sourceId: string;
        targetId?: string;
        status: MigrationRecordStatus;
        error?: string | null;
        warnings: string[];
        metadata?: Prisma.InputJsonObject;
        tx?: any;
    }) {
        const client = params.tx || prisma;
        const metadata = {
            ...(params.metadata ?? {}),
            mode: params.mode,
            sourceRole: params.user.role ?? null,
            sourceGuardianId: params.user.guardianId ?? null,
            facet: DiamondFacets.TENANT_QUANTUM_BACKFILL,
        };

        await client.migrationRecord.upsert({
            where: {
                migrationRunId_source_sourceId: {
                    migrationRunId: params.migrationRunId,
                    source: params.source,
                    sourceId: params.sourceId,
                },
            },
            create: {
                tenantId: params.tenantId,
                migrationRunId: params.migrationRunId,
                source: params.source,
                sourceId: params.sourceId,
                targetType: ResourceTypes.TENANT_USER,
                targetId: params.targetId,
                status: params.status,
                checksum: checksumJson(toChecksumUser(params.user)),
                error: params.error,
                warnings: params.warnings,
                metadata,
            },
            update: {
                targetType: ResourceTypes.TENANT_USER,
                targetId: params.targetId,
                status: params.status,
                checksum: checksumJson(toChecksumUser(params.user)),
                error: params.error,
                warnings: params.warnings,
                metadata,
            },
        });

        return {
            sourceId: params.sourceId,
            targetId: params.targetId,
            status: params.status,
            warnings: params.warnings,
            error: params.error ?? null,
        };
    }

    private static async reconcileOwnerRefs(
        tx: any,
        tenantId: string,
        user: DashboardUserSource,
        tenantUserId: string
    ) {
        const aliases = buildOwnerAliases(user);
        if (aliases.length === 0) return 0;

        const result = await tx.owner.updateMany({
            where: {
                ownerRef: { in: aliases },
                asset: { tenantId },
                revokedAt: null,
            },
            data: {
                ownerRef: tenantUserId,
                document: normalizeDocument(user.cpf),
                documentType: normalizeDocument(user.cpf) ? 'CPF' : undefined,
                label: user.name || undefined,
            },
        });

        return result.count ?? 0;
    }

    private static async migrateCredits(
        tx: any,
        tenantId: string,
        user: DashboardUserSource,
        tenantUserId: string
    ) {
        const amount = Number(user.creditsBalance ?? 0);
        if (!Number.isInteger(amount) || amount <= 0) return null;

        const entry = await CreditLedgerFacet.recordPurchasedCredits(tx, {
            tenantId,
            userId: tenantUserId,
            amount,
            idempotencyKey: `backfill:${DEFAULT_SOURCE}:credits:${user.id}`,
            referenceType: 'legacy_dashboard_user',
            referenceId: String(user.id),
            reason: 'Backfill de créditos B2C do dashboard para ledger canônico.',
            metadata: {
                source: DEFAULT_SOURCE,
                legacyDashboardUserId: String(user.id),
            },
        });

        return entry.id;
    }

    private static async migrateQTags(
        tx: any,
        tenantId: string,
        user: DashboardUserSource,
        tenantUserId: string
    ) {
        const quantity = Number(user.qtagsBalance ?? 0);
        if (!Number.isInteger(quantity) || quantity <= 0) return null;

        const idempotencyKey = `backfill:${DEFAULT_SOURCE}:qtags:${user.id}`;
        const existing = await tx.qTagLedgerEntry.findUnique({
            where: {
                tenantId_idempotencyKey: {
                    tenantId,
                    idempotencyKey,
                },
            },
        });
        if (existing) return existing.id;

        const entry = await tx.qTagLedgerEntry.create({
            data: {
                tenantId,
                userId: tenantUserId,
                entryType: QTagLedgerEntryType.PURCHASED,
                quantity,
                availableDelta: quantity,
                reservedDelta: 0,
                idempotencyKey,
                referenceType: 'legacy_dashboard_user',
                referenceId: String(user.id),
                reason: 'Backfill de saldo QTAG B2C do dashboard para ledger canônico.',
                metadata: {
                    source: DEFAULT_SOURCE,
                    legacyDashboardUserId: String(user.id),
                },
            },
        });

        return entry.id;
    }
}

function buildProfile(user: DashboardUserSource): Record<string, unknown> {
    return {
        dateOfBirth: user.dateOfBirth ?? null,
        relation: user.relation ?? null,
        emergencyContactName: user.emergencyContactName ?? null,
        emergencyContactPhone: user.emergencyContactPhone ?? null,
        bloodType: user.bloodType ?? null,
        allergies: user.allergies ?? null,
    };
}

function buildMetadata(user: DashboardUserSource): Record<string, unknown> {
    const parsed = parseMetadata(user.metadata);
    return {
        ...parsed,
        legacyDashboard: {
            id: String(user.id),
            role: user.role ?? null,
            guardianId: user.guardianId ?? null,
            createdAt: toIsoString(user.createdAt),
            updatedAt: toIsoString(user.updatedAt),
        },
    };
}

function buildOwnerAliases(user: DashboardUserSource): string[] {
    return Array.from(new Set([
        user.openId,
        user.email?.toLowerCase(),
        `qc:user:${user.id}`,
        String(user.id),
        normalizeDocument(user.cpf),
    ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function findDuplicateDocuments(users: DashboardUserSource[]) {
    const counts = new Map<string, number>();
    for (const user of users) {
        const document = normalizeDocument(user.cpf);
        if (!document) continue;
        counts.set(document, (counts.get(document) ?? 0) + 1);
    }

    return new Set(
        Array.from(counts.entries())
            .filter(([, count]) => count > 1)
            .map(([document]) => document)
    );
}

function compareSourceUsers(a: DashboardUserSource, b: DashboardUserSource) {
    const aNumber = Number(a.id);
    const bNumber = Number(b.id);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
    return String(a.id).localeCompare(String(b.id));
}

function toChecksumUser(user: DashboardUserSource) {
    return {
        id: String(user.id),
        openId: user.openId ?? null,
        email: user.email?.toLowerCase() ?? null,
        cpf: normalizeDocument(user.cpf),
        guardianId: user.guardianId ? String(user.guardianId) : null,
        updatedAt: toIsoString(user.updatedAt),
    };
}

function checksumJson(value: unknown) {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function buildRunSummary(report: TenantQuantumBackfillReport): Prisma.InputJsonObject {
    return {
        facet: DiamondFacets.TENANT_QUANTUM_BACKFILL,
        sourceCount: report.sourceCount,
        migratedCount: report.migratedCount,
        skippedCount: report.skippedCount,
        conflictCount: report.conflictCount,
        errorCount: report.errorCount,
        warningCount: report.warnings.length,
    };
}

function parseMetadata(value: unknown): Record<string, unknown> {
    if (!value) return {};
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
                ? parsed as Record<string, unknown>
                : {};
        } catch {
            return {};
        }
    }
    return typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {};
}

function normalizeDocument(value?: string | null): string | null {
    if (!value) return null;
    const normalized = value.replace(/\D/g, '');
    return normalized || null;
}

function normalizeBatchSize(value?: number): number {
    if (!Number.isFinite(value) || !value || value < 1) return DEFAULT_BATCH_SIZE;
    return Math.min(Math.floor(value), 1000);
}

function toIsoString(value?: string | Date | null): string | null {
    if (value instanceof Date) return value.toISOString();
    return typeof value === 'string' && value.length > 0 ? value : null;
}
