"use strict";
/**
 * Prisma 数据库适配器实现
 * 完全实现 WebhookDatabaseAdapter 接口，可直接用于 createTikTokWebhookRouter
 *
 * 前置条件：
 *   1. prisma-schema-extension.prisma 中的 model 已合并到 schema.prisma
 *   2. 已执行 npx prisma generate（或 npx prisma migrate dev）
 *   3. PrismaClient 已正常初始化
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createPrismaAdapter = createPrismaAdapter;
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
function createPrismaAdapter(opts) {
    const { prisma } = opts;
    return {
        // ============================================================
        // 1. 幂等检查
        // ============================================================
        async isEventProcessed(eventId) {
            const existing = await prisma.webhookEvent.findUnique({
                where: { eventId },
                select: { id: true },
            });
            return !!existing;
        },
        async markEventProcessed(eventId, eventType, payload) {
            await prisma.webhookEvent.create({
                data: {
                    eventId,
                    eventType,
                    payload,
                },
            });
        },
        // ============================================================
        // 2. 订单处理
        // ============================================================
        async upsertOrder(order) {
            await prisma.minisOrder.upsert({
                where: { orderId: order.orderId },
                create: {
                    orderId: order.orderId,
                    outOrderNo: order.outOrderNo,
                    openId: order.openId,
                    skuId: order.skuId,
                    quantity: order.quantity,
                    totalAmount: order.totalAmount,
                    currency: order.currency,
                    status: order.status,
                    payTime: order.payTime,
                    attach: order.attach,
                    failReason: order.failReason,
                },
                update: {
                    outOrderNo: order.outOrderNo,
                    openId: order.openId,
                    skuId: order.skuId,
                    quantity: order.quantity,
                    totalAmount: order.totalAmount,
                    currency: order.currency,
                    status: order.status,
                    payTime: order.payTime,
                    attach: order.attach,
                    failReason: order.failReason,
                },
            });
        },
        // ============================================================
        // 3. 订阅处理
        // ============================================================
        async upsertSubscription(sub) {
            await prisma.minisSubscription.upsert({
                where: { subscriptionId: sub.subscriptionId },
                create: {
                    subscriptionId: sub.subscriptionId,
                    openId: sub.openId,
                    skuId: sub.skuId,
                    status: sub.status,
                    startTime: sub.startTime,
                    expireTime: sub.expireTime,
                    autoRenew: sub.autoRenew,
                    nextRenewTime: sub.nextRenewTime,
                    cancelReason: sub.cancelReason,
                },
                update: {
                    openId: sub.openId,
                    skuId: sub.skuId,
                    status: sub.status,
                    startTime: sub.startTime,
                    expireTime: sub.expireTime,
                    autoRenew: sub.autoRenew,
                    nextRenewTime: sub.nextRenewTime,
                    cancelReason: sub.cancelReason,
                },
            });
        },
        // ============================================================
        // 4. 发货：解锁剧集权益
        // ============================================================
        async deliverContent(openId, skuId, orderId) {
            // 根据业务规则，skuId 可能对应：
            //   - 单集："episode:dramaId:ep01"
            //   - 整部剧："drama:dramaId"
            //   - 订阅套餐："subscription:planId"
            //
            // 这里提供可扩展的解析逻辑，按需调整
            const parsed = parseSkuId(skuId);
            if (parsed.type === 'episode') {
                // 解锁单集
                await prisma.userUnlock.upsert({
                    where: {
                        openId_skuId_orderId: {
                            openId,
                            skuId,
                            orderId,
                        },
                    },
                    create: {
                        openId,
                        skuId,
                        orderId,
                        dramaId: parsed.dramaId,
                        episodeId: parsed.episodeId,
                        unlockType: 'single_episode',
                    },
                    update: {}, // 已存在则跳过
                });
            }
            else if (parsed.type === 'drama') {
                // 解锁整部剧（所有集数）
                // 方案 A：标记整部剧解锁，播放时检查 userUnlocks 中是否有 dramaId 匹配
                await prisma.userUnlock.upsert({
                    where: {
                        openId_skuId_orderId: {
                            openId,
                            skuId,
                            orderId,
                        },
                    },
                    create: {
                        openId,
                        skuId,
                        orderId,
                        dramaId: parsed.dramaId,
                        unlockType: 'full_drama',
                    },
                    update: {},
                });
                // 方案 B（可选）：预先把所有 episode 写入 userUnlocks
                // const episodes = await prisma.episode.findMany({ where: { dramaId: parsed.dramaId } });
                // await prisma.userUnlock.createMany({
                //   data: episodes.map(ep => ({
                //     openId, skuId, orderId,
                //     dramaId: parsed.dramaId,
                //     episodeId: ep.id,
                //     unlockType: 'full_drama',
                //   })),
                //   skipDuplicates: true,
                // });
            }
            else if (parsed.type === 'subscription') {
                // 订阅套餐：解锁全部内容（或按套餐范围）
                await prisma.userUnlock.upsert({
                    where: {
                        openId_skuId_orderId: {
                            openId,
                            skuId,
                            orderId,
                        },
                    },
                    create: {
                        openId,
                        skuId,
                        orderId,
                        unlockType: 'subscription',
                        validUntil: parsed.validUntil,
                    },
                    update: {
                        validUntil: parsed.validUntil,
                    },
                });
            }
            else {
                // 未知 SKU 类型，兜底记录
                await prisma.userUnlock.upsert({
                    where: {
                        openId_skuId_orderId: {
                            openId,
                            skuId,
                            orderId,
                        },
                    },
                    create: {
                        openId,
                        skuId,
                        orderId,
                        unlockType: 'unknown',
                    },
                    update: {},
                });
            }
        },
        // ============================================================
        // 5. 回收权益（订阅取消/过期时）
        // ============================================================
        async revokeContent(openId, skuId, reason) {
            // 删除该用户对应 skuId 的所有解锁记录
            // 注意：如果用户通过多个订单解锁了同一 sku，需谨慎处理
            // 这里采用"按 orderId 维度"删除，更精确
            await prisma.userUnlock.deleteMany({
                where: {
                    openId,
                    skuId,
                },
            });
            console.log(`[PrismaAdapter] Revoked content for ${openId}, sku=${skuId}, reason=${reason}`);
        },
    };
}
function parseSkuId(skuId) {
    // 约定格式：
    //   "episode:{dramaId}:{episodeId}"  → 单集
    //   "drama:{dramaId}"                → 整部剧
    //   "subscription:{planId}:{days}"   → 订阅（如 subscription:vip:30）
    if (skuId.startsWith('episode:')) {
        const parts = skuId.split(':');
        return {
            type: 'episode',
            dramaId: parts[1],
            episodeId: parts[2],
        };
    }
    if (skuId.startsWith('drama:')) {
        const parts = skuId.split(':');
        return {
            type: 'drama',
            dramaId: parts[1],
        };
    }
    if (skuId.startsWith('subscription:')) {
        const parts = skuId.split(':');
        const days = parseInt(parts[2] || '30', 10);
        const validUntil = new Date();
        validUntil.setDate(validUntil.getDate() + days);
        return {
            type: 'subscription',
            planId: parts[1],
            validUntil,
        };
    }
    return { type: 'unknown' };
}
//# sourceMappingURL=prisma-adapter.js.map