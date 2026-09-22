import express, { Request, Response, NextFunction } from 'express';
declare global {
  namespace Express {
    interface Response {
      data: (payload: any) => Response;
    }
  }
}
export {};
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { Resend } from 'resend';
import Stripe from 'stripe';
import { PrismaClient } from '@prisma/client';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createTikTokWebhookRouter } from './webhook/tiktok';
import minisWebhookRouter from './minis-webhook';
import minisPaymentRouter from './minis-payment';
import { createPrismaAdapter } from './webhook/prisma-adapter';

const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '',
  },
});


dotenv.config();

const app = express();
const prisma = new PrismaClient();
const resend = new Resend(process.env.RESEND_API_KEY || '');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2024-06-20' });

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://drama.mordernmagic.com';

// ===== Types =====
interface AuthenticatedRequest extends Request {
  userId?: string;
}

// ===== Middleware =====
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized: missing or invalid token' });
    return;
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
    req.userId = decoded.userId;
    next();
  } catch {
    res.status(401).json({ error: 'Unauthorized: invalid token' });
  }
}

function errorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
  console.error('Error:', err);
  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';
  res.status(status).json({ error: message });
}

// ===== CORS =====
app.use(cors({ origin: '*' }));  // ⚠️ 审核期临时通配, 上线前改回 FRONTEND_URL


// === /api/v1 → /api 兼容层（TikTok minis 用绝对路径 /api/v1） ===
app.use((req, _res, next) => {
  if (req.url.startsWith('/api/v1')) {
    req.url = req.url.replace(/^\/api\/v1/, '/api');
  }
  next();
});
app.get('/', (_req, res) => res.json({ status: 'ok' }));  // ⚠️ Railway health check 探 /, 不加 deploy failed
app.use((req, res, next) => {
  res.data = (payload) => res.json({ data: payload });
  next();
});

// ===== Stripe Webhook (MUST be before express.json()) =====
app.post('/api/webhook/stripe', express.raw({ type: 'application/json' }), async (req, res, next) => {
  try {
    const sig = req.headers['stripe-signature'] as string;
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || '';

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      res.status(400).json({ error: `Webhook signature verification failed: ${err.message}` });
      return;
    }

    if (event.type === 'checkout.session.completed') {
      const session = event.data.object as Stripe.Checkout.Session;
      const { userId, dramaId } = session.metadata || {};

      if (userId && dramaId) {
        await prisma.order.updateMany({
          where: { stripeSessionId: session.id },
          data: { status: 'paid' },
        });

        // Create watch history entries for all episodes (unlock)
        const episodes = await prisma.episode.findMany({
          where: { dramaId },
          select: { id: true },
        });
        for (const ep of episodes) {
          await prisma.watchHistory.upsert({
            where: { userId_dramaId_episodeId: { userId, dramaId, episodeId: ep.id } },
            update: {},
            create: { userId, dramaId, episodeId: ep.id, positionSec: 0 },
          });
        }
      }
    }

    res.json({ received: true });
  } catch (err) {
    next(err);
  }
});

// ===== TikTok Minis Webhook (MUST be before express.json()) =====
app.use('/webhook/tiktok', express.raw({ type: 'application/json' }));

// BIG STAR Drama v1.3 — Minis webhook (raw body, MUST before express.json)
app.use('/api/minis/webhook', express.raw({ type: 'application/json' }));
app.use('/api/minis/webhook', minisWebhookRouter);
const tiktokDbAdapter = createPrismaAdapter({ prisma });
app.use(
  '/webhook',
  createTikTokWebhookRouter({
    signature: {
      secret: process.env.BIGSTAR_WEBHOOK_SECRET || process.env.TIKTOK_WEBHOOK_SECRET || '',
      clientKey: process.env.TIKTOK_CLIENT_KEY || '',
      headerName: 'tiktok-signature',
      algorithm: 'tiktok-minis',
      checkTimestamp: true,
      timestampTolerance: 300,
    },
    db: tiktokDbAdapter,
    verbose: process.env.NODE_ENV !== 'production',
  })
);

// ===== JSON body parser for all other routes =====
app.use(express.json());
app.use((req, _res, next) => { (req as any).prisma = prisma; next(); });
app.use((req: any, _res: any, next: any) => { req.prisma = prisma; next(); });
app.use('/api', require('./byteplus-routes'));
const { vodAdapter: byteplusVodAdapter } = require('../byteplus-routes');

// BIG STAR Drama v1.3 — IAP / IAA routes (uses global express.json)
app.use('/api/minis', minisPaymentRouter);

// ===== Health Check =====
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// ===== Auth: Send OTP =====
app.post('/api/auth/send-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email || typeof email !== 'string' || !email.includes('@')) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 min

    await prisma.user.upsert({
      where: { email },
      update: { otpCode: code, otpExpiresAt: expiresAt },
      create: { email, otpCode: code, otpExpiresAt: expiresAt },
    });

    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'noreply@mordernmagic.com',
      to: email,
      subject: 'MORDERN MAGIC 验证码',
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;">
        <h2 style="color:#1a365d;">MORDERN MAGIC</h2>
        <p>您的登录验证码是 <strong style="font-size:24px;color:#1a365d;">${code}</strong>，10 分钟内有效。</p>
        <p style="color:#666;font-size:12px;">如非本人操作，请忽略此邮件。</p>
      </div>`,
    });

    res.data({ success: true, message: 'OTP sent' });
  } catch (err) {
    next(err);
  }
});

// ===== Auth: Verify OTP =====
app.post('/api/auth/verify-otp', async (req, res, next) => {
  try {
    const { email, code } = req.body;
    if (!email || !code) {
      res.status(400).json({ error: 'Email and code required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || user.otpCode !== code || !user.otpExpiresAt || user.otpExpiresAt < new Date()) {
      res.status(400).json({ error: 'Invalid or expired OTP' });
      return;
    }

    // Clear OTP after use
    await prisma.user.update({
      where: { id: user.id },
      data: { otpCode: null, otpExpiresAt: null },
    });

    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.data({ token, user: { id: user.id, email: user.email } });
  } catch (err) {
    next(err);
  }
});

// ===== Dramas: List =====
app.get('/api/dramas', async (_req, res, next) => {
  try {
    const dramas = await prisma.drama.findMany({
      select: { slug: true, title: true, cover: true, totalEpisodes: true, priceCents: true },
      orderBy: { createdAt: 'desc' },
    });
    res.data(dramas);
  } catch (err) {
    next(err);
  }
});

// ===== Dramas: Detail =====
app.get('/api/dramas/:slug', async (req, res, next) => {
  try {
    const drama = await prisma.drama.findUnique({
      where: { slug: req.params.slug },
      include: {
        episodes: {
          select: { id: true, episodeNumber: true, s3Key: true, durationSec: true },
          orderBy: { episodeNumber: 'asc' },
        },
      },
    });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }
    res.data(drama);
  } catch (err) {
    next(err);
  }
});

// ===== Dramas: Episodes List =====
app.get('/api/dramas/:slug/episodes', async (req, res, next) => {
  try {
    const drama = await prisma.drama.findUnique({
      where: { slug: req.params.slug },
      select: { id: true },
    });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }
    const episodes = await prisma.episode.findMany({
      where: { dramaId: drama.id },
      select: { id: true, episodeNumber: true, s3Key: true, durationSec: true },
      orderBy: { episodeNumber: 'asc' },
    });
    res.data(episodes);
  } catch (err) {
    next(err);
  }
});

app.post('/api/payment/create-checkout', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { dramaSlug, email } = req.body;
    if (!dramaSlug) {
      res.status(400).json({ error: 'dramaSlug required' });
      return;
    }

    const drama = await prisma.drama.findUnique({ where: { slug: dramaSlug } });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: drama.title, images: drama.cover ? [drama.cover] : undefined },
          unit_amount: drama.priceCents,
        },
        quantity: 1,
      }],
      mode: 'payment',
      customer_email: email,
      metadata: { userId: req.userId!, dramaId: drama.id },
      success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${FRONTEND_URL}/drama/${dramaSlug}`,
    });

    // Create pending order
    await prisma.order.create({
      data: {
        userId: req.userId!,
        dramaId: drama.id,
        stripeSessionId: session.id,
        amountCents: drama.priceCents,
        status: 'pending',
      },
    });

    res.data({ sessionId: session.id, url: session.url });
  } catch (err) {
    next(err);
  }
});

// ===== Watch History: Get =====
app.get('/api/watch-history', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const history = await prisma.watchHistory.findMany({
      where: { userId: req.userId },
      include: {
        drama: { select: { slug: true, title: true, cover: true } },
        episode: { select: { episodeNumber: true, durationSec: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    res.data(history);
  } catch (err) {
    next(err);
  }
});

// ===== Watch History: Upsert =====
app.post('/api/watch-history', requireAuth, async (req: AuthenticatedRequest, res, next) => {
  try {
    const { dramaSlug, episodeId, positionSec } = req.body;
    if (!dramaSlug || !episodeId || positionSec === undefined) {
      res.status(400).json({ error: 'dramaSlug, episodeId, positionSec required' });
      return;
    }

    const drama = await prisma.drama.findUnique({ where: { slug: dramaSlug } });
    if (!drama) {
      res.status(404).json({ error: 'Drama not found' });
      return;
    }

    const record = await prisma.watchHistory.upsert({
      where: { userId_dramaId_episodeId: { userId: req.userId!, dramaId: drama.id, episodeId } },
      update: { positionSec: Number(positionSec) },
      create: {
        userId: req.userId!,
        dramaId: drama.id,
        episodeId,
        positionSec: Number(positionSec),
      },
    });

    res.data(record);
  } catch (err) {
    next(err);
  }
});

// ===== Error handler (must be last) =====
app.all('/api/dramas/:slug/episodes/:episodeNumber/play-auth', async (req, res, next) => {
  try {
    const { slug, episodeNumber } = req.params;
    const ep = await prisma.episode.findFirst({
      where: { drama: { slug }, episodeNumber: Number(episodeNumber) },
    });
    if (!ep) return res.status(404).json({ error: 'episode not found' });

    let playUrl: string | null = null;
    let subtitleUrl: string | null = null;
    let subtitleFormat = 'srt';
    let subtitleLang = 'en';
    let source = 'pending';

    // 1) BytePlus first
    if (ep.byteplusVid && byteplusVodAdapter) {
      try {
        const bp = await byteplusVodAdapter.getPlayInfo(ep.byteplusVid);
        const pi = bp?.Result?.PlayInfoList?.[0];
        if (pi) {
          playUrl = pi.MainPlayUrl || pi.PlayUrl;
          const subs = pi.SubtitleInfoList || pi.SubtitleList || [];
          const enSub = subs.find((s: any) =>
            (s.Language || s.Lang || '').toLowerCase().startsWith('en')
          ) || subs[0];
          if (enSub) {
            subtitleUrl = enSub.SubtitleUrl || enSub.Url;
            subtitleFormat = enSub.Format || 'srt';
            subtitleLang = enSub.Language || enSub.Lang || 'en';
          }
          source = 'byteplus';
        }
      } catch (e: any) {
        console.warn('[play-auth] BytePlus failed:', e.message);
      }
    }

    // 2) S3 fallback
    if (!playUrl && ep.s3Key) {
      try {
        const cmd = new GetObjectCommand({
          Bucket: process.env.S3_BUCKET || 'mordernmagic-drama-media',
          Key: ep.s3Key,
        });
        playUrl = await getSignedUrl(s3, cmd, { expiresIn: 604800 });
        source = 's3-presigned';
      } catch (e: any) {
        console.warn('[play-auth] S3 presign failed:', e.message);
      }
    }

    if (!subtitleUrl) {
      const subtitleS3Key = `subtitles/en/ep${String(Number(episodeNumber)).padStart(2, '0')}.srt`;
      try {
        subtitleUrl = await getSignedUrl(
          s3,
          new GetObjectCommand({
            Bucket: process.env.S3_BUCKET || 'mordernmagic-drama-media',
            Key: subtitleS3Key,
          }),
          { expiresIn: 300 }
        );
      } catch (e) {
        console.log('Subtitle not found for key:', subtitleS3Key);
      }
    }

    if (!playUrl) {
      return res.status(500).json({ error: 'no video source', source });
    }

    res.data({ playUrl, subtitleUrl, subtitleFormat, subtitleLang, source });
  } catch (e: any) {
    next(e);
  }
});

app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

