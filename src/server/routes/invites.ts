import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { type AppEnv, jsonError, jsonOk, requireDb } from '@server/lib/http';
import { requireAuth } from '@server/middleware/auth';
import { type AcceptInviteResult, acceptInvite, getInvitePreview } from '@server/services/invite-service';
import type { AcceptInvitePayload, InvitePreview } from '@shared/types/domain';
import { INVITE_TOKEN_PATTERN } from '@shared/validation/invite';

/** Route publik penerima undangan: `/api/invites/:token`. */
export const inviteRoutes = new Hono<AppEnv>();

const ACCEPT_ERRORS: Record<
  Exclude<AcceptInviteResult, { ok: true }>['code'],
  { status: ContentfulStatusCode; message: string }
> = {
  INVITE_NOT_FOUND: { status: 404, message: 'Undangan tidak ditemukan atau sudah dibatalkan.' },
  INVITE_EXPIRED: { status: 410, message: 'Undangan sudah kedaluwarsa. Minta link baru ke admin.' },
  INVITE_USED: { status: 410, message: 'Undangan ini sudah dipakai.' },
  INVITE_EMAIL_MISMATCH: {
    status: 403,
    message: 'Undangan ini ditujukan untuk email lain. Masuk dengan akun Google yang diundang.',
  },
};

// Preview tidak butuh login agar calon anggota bisa melihat undangan sebelum masuk.
inviteRoutes.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return jsonError(c, 404, 'INVITE_NOT_FOUND', ACCEPT_ERRORS.INVITE_NOT_FOUND.message);
  }

  const db = requireDb(c);
  if (db instanceof Response) return db;

  const preview = await getInvitePreview(db, token);
  if (!preview) {
    return jsonError(c, 404, 'INVITE_NOT_FOUND', ACCEPT_ERRORS.INVITE_NOT_FOUND.message);
  }
  return jsonOk<InvitePreview>(c, preview);
});

inviteRoutes.post('/:token/accept', requireAuth, async (c) => {
  const token = c.req.param('token');
  if (!INVITE_TOKEN_PATTERN.test(token)) {
    return jsonError(c, 404, 'INVITE_NOT_FOUND', ACCEPT_ERRORS.INVITE_NOT_FOUND.message);
  }

  const db = requireDb(c);
  if (db instanceof Response) return db;

  const result = await acceptInvite(db, token, c.get('authUser'));
  if (!result.ok) {
    const { status, message } = ACCEPT_ERRORS[result.code];
    return jsonError(c, status, result.code, message);
  }
  return jsonOk<AcceptInvitePayload>(c, {
    workspace: result.workspace,
    alreadyMember: result.alreadyMember,
  });
});
