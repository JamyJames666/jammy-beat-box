// This script applies Prisma migrations
// and then starts Muse.
import {execa, ExecaError} from 'execa';
import {promises as fs} from 'fs';
import Prisma from '@prisma/client';
import ora from 'ora';
import {startBot} from '../index.js';
import logBanner from '../utils/log-banner.js';
import createDatabaseUrl, {createDatabasePath} from '../utils/create-database-url.js';
import {DATA_DIR} from '../services/config.js';

process.env.DATABASE_URL = process.env.DATABASE_URL ?? createDatabaseUrl(DATA_DIR);

const migrateFromSequelizeToPrisma = async () => {
  await execa('prisma', ['migrate', 'resolve', '--applied', '20220101155430_migrate_from_sequelize'], {preferLocal: true});
};

const doesUserHaveExistingDatabase = async () => {
  try {
    await fs.access(createDatabasePath(DATA_DIR));

    return true;
  } catch {
    return false;
  }
};

const hasDatabaseBeenMigratedToPrisma = async () => {
  const client = new Prisma.PrismaClient();

  try {
    await client.$queryRaw`SELECT COUNT(id) FROM _prisma_migrations`;
  } catch (error: unknown) {
    if (error instanceof Prisma.Prisma.PrismaClientKnownRequestError && error.code === 'P2010') {
      // Table doesn't exist
      await client.$disconnect();
      return false;
    }

    await client.$disconnect();
    throw error;
  }

  await client.$disconnect();
  return true;
};

(async () => {
  // Banner
  logBanner();

  const spinner = ora('Applying database migrations...').start();

  if (await doesUserHaveExistingDatabase()) {
    if (!(await hasDatabaseBeenMigratedToPrisma())) {
      try {
        await migrateFromSequelizeToPrisma();
      } catch (error) {
        if ((error as ExecaError).stderr) {
          spinner.fail('Failed to apply database migrations (going from Sequelize to Prisma):');
          console.error((error as ExecaError).stderr);
          process.exit(1);
        } else {
          throw error;
        }
      }
    }
  }

  // If a previous migration run crashed mid-flight, Prisma marks it as failed
  // and refuses to deploy with P3009 until the record is cleared. Remove any
  // rows from _prisma_migrations that never finished (NULL finished_at means
  // started but not completed — either crashed or rolled back). This lets
  // migrate deploy retry them cleanly on every restart.
  const prismaClient = new Prisma.PrismaClient();
  try {
    await prismaClient.$executeRawUnsafe(
      'DELETE FROM _prisma_migrations WHERE finished_at IS NULL',
    );
  } catch {
    // Table may not exist yet on a fresh database — that is fine.
  }

  await prismaClient.$disconnect();

  try {
    await execa('prisma', ['migrate', 'deploy'], {preferLocal: true});
  } catch (error: unknown) {
    if ((error as ExecaError).stderr) {
      spinner.fail('Failed to apply database migrations:');
      console.error((error as ExecaError).stderr);
      process.exit(1);
    } else {
      throw error;
    }
  }

  spinner.succeed('Database migrations applied.');

  // The 20260530000000 migration accidentally omitted several Setting columns.
  // Guard: after every deploy, ensure all required columns exist and add any
  // that are missing. ALTER TABLE ADD COLUMN is a no-op if the col is there;
  // if not, it is added with the correct default so Prisma stops crashing.
  const healClient = new Prisma.PrismaClient();
  try {
    const rows = await healClient.$queryRaw<Array<{name: string}>>`PRAGMA table_info("Setting")`;
    const existing = new Set(rows.map((r: {name: string}) => r.name));
    const missing: Array<[string, string]> = [
      ['queueAddResponseEphemeral', 'BOOLEAN NOT NULL DEFAULT false'],
      ['defaultVolume', 'INTEGER NOT NULL DEFAULT 100'],
      ['defaultQueuePageSize', 'INTEGER NOT NULL DEFAULT 10'],
      ['turnDownVolumeWhenPeopleSpeak', 'BOOLEAN NOT NULL DEFAULT false'],
      ['turnDownVolumeWhenPeopleSpeakTarget', 'INTEGER NOT NULL DEFAULT 20'],
    ].filter(([col]) => !existing.has(col)) as Array<[string, string]>;

    for (const [col, def] of missing) {
      // eslint-disable-next-line no-await-in-loop
      await healClient.$executeRawUnsafe(`ALTER TABLE "Setting" ADD COLUMN "${col}" ${def}`);
    }
  } catch {
    // Table doesn't exist yet on a brand-new database — migrations will create it.
  }

  await healClient.$disconnect();

  await startBot();
})();
