"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// BIG STAR Drama v1.3 — Minis payment routes
// Mounted in index.ts line 154: app.use('/api/minis', minisPaymentRouter)
// Aligned with existing mordernmagic-drama schema:
//   - MinisOrder: snake_case + @map; fields openId/skuId/orderId/skuType/dramaId/episodeId/totalAmount/currency/status/attach/paidAt
//   - UserUnlock (NOT MinisUnlock): openId/dramaId/episodeId/type/source
//   - Drama.slug @unique | Episode.@@unique([dramaId, episodeNumber])
//   - MinisOrder @@unique([openId, skuId, orderId])
//   - UserUnlock @@unique([openId, dramaId, episodeId, type])
const express_1 = require("express");
const router = (0, express_1.Router)();
// TODO: Verify TikTok Beans ↔ USD exchange rate before launch.
// Reference values (subject to change):
//   $0.20 per episode  ≈ 20 Beans  (assuming 1 Bean = $0.01)
//   $4.99 full series  ≈ 500 Beans (assuming 1 Bean = $0.01)
const TIKTOK_CURRENCY = 'BEANS';
const PRICE_BEANS_PER_EPISODE = 20;
const PRICE_BEANS_FULL_SERIES = 500;
function buildAttach(meta) {
    return JSON.stringify(meta);
}
async function upsertPendingOrder(prisma, openId, skuId, orderId, attachJson, priceBeans, skuType, dramaId, episodeId) {
    const existing = await prisma.minisOrder.findFirst({ where: { openId, skuId, orderId } });
    if (existing) {
        return prisma.minisOrder.update({
            where: { id: existing.id },
            data: {
                attach: attachJson,
                totalAmount: priceBeans,
                currency: TIKTOK_CURRENCY,
                status: 'PENDING',
                skuType,
                dramaId,
                episodeId: episodeId || undefined,
            },
        });
    }
    return prisma.minisOrder.create({
        data: {
            openId,
            skuId,
            orderId,
            status: 'PENDING',
            totalAmount: priceBeans,
            currency: TIKTOK_CURRENCY,
            attach: attachJson,
            skuType,
            dramaId,
            episodeId: episodeId || undefined,
        },
    });
}
// POST /api/minis/trade-order/create
// Body: { openId, skuId: 'bigstar_ep_XX' | 'bigstar_full_series', dramaSlug, episodeNumber? }
router.post('/trade-order/create', async (req, res) => {
    const prisma = req.prisma;
    const { openId, skuId, dramaSlug, episodeNumber } = req.body || {};
    if (!openId || !skuId || !dramaSlug) {
        return res.status(400).json({ ok: false, error: 'Missing required: openId, skuId, dramaSlug' });
    }
    const drama = await prisma.drama.findUnique({ where: { slug: dramaSlug } });
    if (!drama) {
        return res.status(404).json({ ok: false, error: `Drama not found: ${dramaSlug}` });
    }
    let priceBeans = 0;
    let type = 'single_episode';
    let attach;
    if (skuId === 'bigstar_full_series') {
        priceBeans = PRICE_BEANS_FULL_SERIES;
        type = 'full_series';
        attach = { drama_id: drama.id, drama_slug: drama.slug, type };
    }
    else if (/^bigstar_ep_\d{1,3}$/.test(skuId)) {
        if (typeof episodeNumber !== 'number' || !Number.isInteger(episodeNumber) || episodeNumber < 1 || episodeNumber > 999) {
            return res.status(400).json({ ok: false, error: 'episodeNumber required (integer)' });
        }
        const episode = await prisma.episode.findUnique({
            where: { dramaId_episodeNumber: { dramaId: drama.id, episodeNumber } },
        });
        if (!episode) {
            return res.status(404).json({ ok: false, error: `Episode ${episodeNumber} not found for ${dramaSlug}` });
        }
        if (episodeNumber <= 5) {
            return res.status(400).json({ ok: false, error: `Episode ${episodeNumber} is free, no order required` });
        }
        priceBeans = PRICE_BEANS_PER_EPISODE;
        type = 'single_episode';
        attach = {
            drama_id: drama.id,
            drama_slug: drama.slug,
            episode_id: episode.id,
            episode_number: episode.episodeNumber,
            type,
        };
    }
    else {
        return res.status(400).json({ ok: false, error: `Unknown skuId: ${skuId}` });
    }
    const orderId = `bs_${openId.slice(-8)}_${skuId}_${Date.now()}`;
    const attachJson = buildAttach(attach);
    await upsertPendingOrder(prisma, openId, skuId, orderId, attachJson, priceBeans, type, drama.id, attach.episode_id ?? null);
    return res.json({
        ok: true,
        orderId,
        skuId,
        price: { amount: priceBeans, currency: TIKTOK_CURRENCY },
        drama: { id: drama.id, slug: drama.slug, title: drama.title },
        episode: attach.episode_number ? { number: attach.episode_number } : null,
        type,
    });
});
// GET /api/minis/order-status/:orderId
router.get('/order-status/:orderId', async (req, res) => {
    const prisma = req.prisma;
    const { orderId } = req.params;
    if (!orderId)
        return res.status(400).json({ ok: false, error: 'orderId required' });
    const order = await prisma.minisOrder.findFirst({ where: { orderId } });
    if (!order)
        return res.status(404).json({ ok: false, error: 'Order not found' });
    return res.json({
        ok: true,
        orderId: order.orderId,
        status: order.status,
        skuId: order.skuId,
        skuType: order.skuType,
        totalAmount: order.totalAmount,
        currency: order.currency,
        paidAt: order.paidAt,
    });
});
// POST /api/minis/ad-unlock
// Body: { openId, dramaSlug, episodeNumber, adUnitId }
const ALLOWED_AD_UNITS = (process.env.TIKTOK_AD_UNIT_IDS || '').split(',').filter(Boolean);
router.post('/ad-unlock', async (req, res) => {
    const prisma = req.prisma;
    const { openId, dramaSlug, episodeNumber, adUnitId } = req.body || {};
    if (!openId || !dramaSlug || typeof episodeNumber !== 'number' || !adUnitId) {
        return res.status(400).json({ ok: false, error: 'Missing required: openId, dramaSlug, episodeNumber, adUnitId' });
    }
    if (!ALLOWED_AD_UNITS.includes(adUnitId)) {
        console.warn('[ad-unlock] reject invalid adUnitId:', openId, adUnitId);
        return res.status(400).json({ ok: false, error: 'Invalid adUnitId' });
    }
    const drama = await prisma.drama.findUnique({ where: { slug: dramaSlug } });
    if (!drama)
        return res.status(404).json({ ok: false, error: `Drama not found: ${dramaSlug}` });
    const episode = await prisma.episode.findUnique({
        where: { dramaId_episodeNumber: { dramaId: drama.id, episodeNumber } },
    });
    if (!episode)
        return res.status(404).json({ ok: false, error: `Episode ${episodeNumber} not found` });
    if (episodeNumber <= 5) {
        return res.status(400).json({ ok: false, error: `Episode ${episodeNumber} is free, no unlock needed` });
    }
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentUnlock = await prisma.userUnlock.findFirst({
        where: {
            openId,
            episodeId: episode.id,
            unlockType: 'ad_unlock',
            createdAt: { gte: oneHourAgo },
        },
    });
    if (recentUnlock) {
        return res.status(429).json({ ok: false, error: 'Too frequent, try again later' });
    }
    const skuId = `ad_unlock_${episodeNumber}`;
    const orderId = `ad_${openId.slice(-8)}_${episode.id}`;
    const attach = {
        drama_id: drama.id,
        drama_slug: drama.slug,
        episode_id: episode.id,
        episode_number: episode.episodeNumber,
        type: 'ad_unlock',
    };
    const attachJson = buildAttach(attach);
    await prisma.minisOrder.upsert({
        where: { openId_skuId_orderId: { openId, skuId, orderId } },
        create: {
            openId, skuId, orderId,
            status: 'SUCCESS',
            skuType: 'ad_unlock',
            dramaId: drama.id,
            episodeId: episode.id,
            totalAmount: 0,
            currency: TIKTOK_CURRENCY,
            attach: attachJson,
            paidAt: new Date(),
        },
        update: {
            status: 'SUCCESS',
            paidAt: new Date(),
        },
    });
    await prisma.userUnlock.upsert({
        where: {
            openId_skuId_orderId: {
                openId, skuId, orderId,
            },
        },
        create: {
            openId, skuId, orderId,
            dramaId: drama.id,
            episodeId: episode.id,
            unlockType: 'ad_unlock',
        },
        update: {},
    });
    console.log('[ad-unlock]', JSON.stringify({
        openId, dramaSlug, episodeNumber, adUnitId,
        ts: new Date().toISOString(),
    }));
    return res.json({
        ok: true,
        unlocked: true,
        drama: { slug: drama.slug },
        episode: { number: episode.episodeNumber },
        via: 'ad',
    });
});
exports.default = router;
//# sourceMappingURL=minis-payment.js.map