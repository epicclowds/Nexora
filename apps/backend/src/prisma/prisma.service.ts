import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { AppConfig } from '../config/app-config';
import { PrismaClient } from '../generated/prisma/client';

/** Builds MariaDB-connector pool options from a mysql:// URL (compatible with MySQL 8.4). */
export function poolConfigFromUrl(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: Number(url.searchParams.get('connection_limit') ?? 10),
    // MySQL 8 defaults to caching_sha2_password; inside the private Docker
    // network the RSA public key may be fetched from the server.
    allowPublicKeyRetrieval: true,
    timezone: 'Z',
  };
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(config: AppConfig) {
    super({ adapter: new PrismaMariaDb(poolConfigFromUrl(config.env.DATABASE_URL)) });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
