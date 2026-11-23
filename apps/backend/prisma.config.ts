import { defineConfig } from 'prisma/config';

// DATABASE_URL is only required for commands that talk to the database
// (migrate deploy/dev). `prisma generate` and `prisma validate` work without it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    url: process.env.DATABASE_URL ?? 'mysql://unset:unset@localhost:3306/unset',
  },
});
