import { OAuth2Client } from 'google-auth-library';
import { writePool } from '../../../database/index.js';
import crypto from 'crypto';
import bcrypt from 'bcrypt';
import { assignDefaultRole } from '../helpers/auth.shared.js';
import { createAccessToken } from '../helpers/createAccessToken.js';
import { HttpError } from '../../../common/httpError.js';

const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI,
);

export async function oAuthLoginInternal({ params: routeParams, body: inputBody }) {
  let client = null;
  const provider = String(routeParams.provider || '').toLowerCase();

  if (provider !== 'google') {
    throw new HttpError(400, { message: `Unsupported provider: ${provider}` });
  }

  const code = inputBody?.code;
  if (!code) {
    throw new HttpError(400, { message: 'Missing code' });
  }

  try {
    const { tokens } = await googleClient.getToken(code);

    if (!tokens) {
      throw new HttpError(400, { message: 'Failed to exchange code for tokens' });
    }

    let p = null;

    if (tokens.id_token) {
      const ticket = await googleClient.verifyIdToken({
        idToken: tokens.id_token,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      p = ticket.getPayload();
    }

    if (!p && tokens.access_token) {
      const response = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!response.ok) {
        throw new HttpError(400, { message: 'Failed to fetch Google user info' });
      }

      p = await response.json();
    }

    const provider_user_id = p?.sub;
    const email = (p?.email || '').toLowerCase();
    const full_name = p?.name || null;
    const picture = p?.picture || null;

    if (!provider_user_id || !email) {
      throw new HttpError(400, { message: 'Invalid Google token payload' });
    }

    const allowedHd = process.env.GOOGLE_ALLOWED_HD;
    if (allowedHd && p?.hd !== allowedHd) {
      throw new HttpError(403, { message: 'Google domain not allowed' });
    }
    client = await writePool.connect();
    await client.query('BEGIN');

    const idRes = await client.query(
      `
      SELECT u.id, u.email, u.full_name, u.image_url, u.description, u.eaes_member, u.authz_version
      FROM public.auth_identities ai
      JOIN public.users u ON u.id = ai.user_id
      WHERE ai.provider = $1 AND ai.provider_user_id = $2
      LIMIT 1
      `,
      [provider, provider_user_id],
    );

    let userRow;
    let is_new_user = false;
    let linked_existing_account = false;

    if (idRes.rowCount) {
      userRow = idRes.rows[0];
    } else {
      const userRes = await client.query(
        `
        SELECT id, email, full_name, image_url, description, eaes_member, authz_version
        FROM public.users
        WHERE lower(email) = $1
        LIMIT 1
        `,
        [email],
      );

      if (userRes.rowCount) {
        userRow = userRes.rows[0];
        linked_existing_account = true;

        try {
          await client.query(
            `
            INSERT INTO public.auth_identities (user_id, provider, provider_user_id, email)
            VALUES ($1, $2, $3, $4)
            `,
            [userRow.id, provider, provider_user_id, email],
          );
        } catch (e) {
          if (e instanceof HttpError) throw e;
          if (e?.code === '23505') {
            await client.query('ROLLBACK');
            throw new HttpError(409, {
              message: 'This Google account is already linked to another user.',
              code: 'PROVIDER_ALREADY_LINKED',
            });
          }
          throw e;
        }

        if ((!userRow.full_name && full_name) || (!userRow.image_url && picture)) {
          const upd = await client.query(
            `
            UPDATE public.users
            SET
              full_name = COALESCE(full_name, $2),
              image_url = COALESCE(image_url, $3)
            WHERE id = $1
            RETURNING id, email, full_name, image_url, description, eaes_member, authz_version
            `,
            [userRow.id, full_name, picture],
          );

          userRow = upd.rows[0];
        }
      } else {
        is_new_user = true;

        const saltRounds = Number(process.env.BCRYPT_ROUNDS || 12);
        const randomPass = crypto.randomBytes(32).toString('hex');
        const randomHash = await bcrypt.hash(randomPass, saltRounds);

        const insUser = await client.query(
          `
          INSERT INTO public.users (email, password_hash, full_name, image_url)
          VALUES ($1, $2, $3, $4)
          RETURNING id, email, full_name, image_url, description, eaes_member, authz_version
          `,
          [email, randomHash, full_name, picture],
        );

        userRow = insUser.rows[0];

        await assignDefaultRole(client, userRow.id);

        await client.query(
          `
          INSERT INTO public.auth_identities (user_id, provider, provider_user_id, email)
          VALUES ($1, $2, $3, $4)
          `,
          [userRow.id, provider, provider_user_id, email],
        );
      }
    }

    await client.query(
      `
      UPDATE public.users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [userRow.id],
    );

    await client.query('COMMIT');

    const token = createAccessToken(userRow);

    return {
      user: {
        email: userRow.email,
        full_name: userRow.full_name,
        image_url: userRow.image_url,
        description: userRow.description,
        eaes_member: userRow.eaes_member,
      },
      token,
      provider,
      is_new_user,
      linked_existing_account,
    };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (client) await client.query('ROLLBACK').catch(() => {});
    console.error('OAuth login error:', err);
    throw new HttpError(500, { message: 'OAuth login failed' });
  } finally {
    if (client) client.release();
  }
}
