/**
 * Prisma 数据库适配器实现
 * 完全实现 WebhookDatabaseAdapter 接口，可直接用于 createTikTokWebhookRouter
 *
 * 前置条件：
 *   1. prisma-schema-extension.prisma 中的 model 已合并到 schema.prisma
 *   2. 已执行 npx prisma generate（或 npx prisma migrate dev）
 *   3. PrismaClient 已正常初始化
 */
import { PrismaClient } from '@prisma/client';
import type { WebhookDatabaseAdapter } from './types';
export interface PrismaAdapterOptions {
    prisma: PrismaClient;
}
/**
 * 创建基于 Prisma 的数据库适配器
 *
 * 使用示例：
 *   import { PrismaClient } from '@prisma/client';
 *   import { createPrismaAdapter } from './webhook/prisma-adapter';
 *   import { createTikTokWebhookRouter } from './webhook/tiktok';
 *
 *   const prisma = new PrismaClient();
 *   const dbAdapter = createPrismaAdapter({ prisma });
 *
 *   app.use('/webhook', createTikTokWebhookRouter({
 *     signature: { secret: process.env.TIKTOK_WEBHOOK_SECRET! },
 *     db: dbAdapter,
 *   }));
 */
export declare function createPrismaAdapter(opts: PrismaAdapterOptions): WebhookDatabaseAdapter;
//# sourceMappingURL=prisma-adapter.d.ts.map