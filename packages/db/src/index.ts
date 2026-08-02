export {
  withUser,
  withTenant,
  forTenant,
  asPlatform,
  disconnect,
  TenantContextError,
  type TenantDb,
} from './tenant-client.ts';

export { PrismaClient, Prisma } from '../prisma/client/index.js';
