import dotenv from 'dotenv';
import { execFileSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { MigrationMode } from '@prisma/client';
import {
    DashboardUserSource,
    TenantQuantumBackfillFacet,
} from '../services/core-facets/TenantQuantumBackfillFacet';

dotenv.config();

type CliOptions = {
    mode?: MigrationMode;
    batchSize?: number;
    resumeRunId?: string;
    reportJson?: string;
    sourceJson?: string;
    dashboardDatabaseUrl?: string;
};

async function main() {
    const options = parseArgs(process.argv.slice(2));

    if (!options.mode) {
        throw new Error('Informe --dry-run ou --execute.');
    }

    const users = loadSourceUsers(options);
    const report = await TenantQuantumBackfillFacet.run({
        mode: options.mode,
        users,
        batchSize: options.batchSize,
        resumeRunId: options.resumeRunId,
        source: options.sourceJson ? 'qc-dashboard.users.json' : 'qc-dashboard.users',
    });

    const prettyReport = JSON.stringify(report, null, 2);
    if (options.reportJson) {
        writeFileSync(options.reportJson, prettyReport);
    }

    console.log(prettyReport);
}

function parseArgs(args: string[]): CliOptions {
    const options: CliOptions = {};

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const next = args[index + 1];

        if (arg === '--dry-run') options.mode = MigrationMode.DRY_RUN;
        else if (arg === '--execute') options.mode = MigrationMode.EXECUTE;
        else if (arg === '--batch-size') {
            options.batchSize = Number(next);
            index += 1;
        } else if (arg === '--resume') {
            options.resumeRunId = next;
            index += 1;
        } else if (arg === '--report-json') {
            options.reportJson = next;
            index += 1;
        } else if (arg === '--source-json') {
            options.sourceJson = next;
            index += 1;
        } else if (arg === '--dashboard-database-url') {
            options.dashboardDatabaseUrl = next;
            index += 1;
        } else {
            throw new Error(`Argumento desconhecido: ${arg}`);
        }
    }

    return options;
}

function loadSourceUsers(options: CliOptions): DashboardUserSource[] {
    if (options.sourceJson) {
        const parsed = JSON.parse(readFileSync(options.sourceJson, 'utf8'));
        if (!Array.isArray(parsed)) {
            throw new Error('--source-json deve apontar para um array JSON de usuários.');
        }
        return parsed as DashboardUserSource[];
    }

    const dashboardDatabaseUrl = options.dashboardDatabaseUrl
        || process.env.DASHBOARD_DATABASE_URL
        || process.env.QC_DASHBOARD_DATABASE_URL;

    if (!dashboardDatabaseUrl) {
        throw new Error(
            'Informe --source-json ou DASHBOARD_DATABASE_URL/QC_DASHBOARD_DATABASE_URL para ler o banco do dashboard.'
        );
    }

    return readDashboardUsersWithPsql(dashboardDatabaseUrl);
}

function readDashboardUsersWithPsql(databaseUrl: string): DashboardUserSource[] {
    const query = `
      SELECT COALESCE(json_agg(row_to_json(source_users)), '[]'::json)
      FROM (
        SELECT
          id,
          "openId",
          name,
          email,
          phone,
          cpf,
          role,
          "guardianId",
          "dateOfBirth",
          relation,
          "emergencyContactName",
          "emergencyContactPhone",
          "bloodType",
          allergies,
          metadata,
          "createdAt",
          "updatedAt",
          "lastSignedIn"
        FROM users
        ORDER BY id ASC
      ) source_users;
    `;

    try {
        const output = execFileSync('psql', [
            databaseUrl,
            '--no-align',
            '--tuples-only',
            '--quiet',
            '--command',
            query,
        ], {
            encoding: 'utf8',
            maxBuffer: 20 * 1024 * 1024,
        });
        const parsed = JSON.parse(output.trim() || '[]');
        if (!Array.isArray(parsed)) {
            throw new Error('Consulta do dashboard não retornou array JSON.');
        }
        return parsed as DashboardUserSource[];
    } catch (error) {
        const message = error instanceof Error ? error.message : 'erro desconhecido';
        throw new Error(`Não foi possível ler usuários do dashboard via psql: ${message}`);
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
