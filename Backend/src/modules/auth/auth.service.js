import {  readPool,writePool } from "../../database/index.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import crypto from 'crypto';
import axios from "axios";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import multer from "multer";
import {s3} from "../storage/r2.client.js"
import { PutObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { randomUUID } from "crypto";
import sharp from "sharp";

import { logEvent } from '../../common/logger.js';

import { OAuth2Client } from "google-auth-library";


const R2_BUCKET = process.env.R2_BUCKET;
const R2_PUBLIC_BASE_URL = (process.env.R2_PUBLIC_BASE_URL || "").replace(/\/+$/, "");


// 2) Multer (memory storage)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 }, 
});

export const profilePictureUploadMiddleware = upload.single("file");

// 3) Zod validacija fajla
const fileSchema = z.object({
  mimetype: z.enum(["image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().positive().max(4 * 1024 * 1024),
});


// Helper: izvuci key iz URL-a ako je URL naš (baziran na R2_PUBLIC_BASE_URL)
function extractKeyFromPublicUrl(url) {
  if (!url || !R2_PUBLIC_BASE_URL) return null;
  if (!url.startsWith(R2_PUBLIC_BASE_URL + "/")) return null;
  return url.slice((R2_PUBLIC_BASE_URL + "/").length);
}

// POST /user/profile-picture  (multipart/form-data, key: file)
export async function handleProfilePictureUpload(req, res) {
    try {
      const userId = req.user?.sub || null;
      if (!userId) return res.status(401).json({ message: "Unauthorized" });

      // 1) Učitaj staru sliku iz baze (treba nam i za upload i za delete)
      const { rows: existingRows } = await writePool.query(
        "SELECT image_url FROM public.users WHERE id = $1",
        [userId]
      );

      const oldUrl = existingRows[0]?.image_url || null;
      const oldKey = extractKeyFromPublicUrl(oldUrl);

      // ✅ Ako fajl NE postoji -> tretiraj kao "remove profile picture"
      if (!req.file) {
        // prvo null u bazi
        const { rows } = await writePool.query(
          `
          UPDATE public.users
          SET image_url = NULL, updated_at = NOW()
          WHERE id = $1
          RETURNING image_url
          `,
          [userId]
        );

        // onda best-effort brisanje iz R2 (DeleteObject je idempotent; ako ne postoji, uglavnom je OK)
        if (oldKey) {
          try {
            await s3.send(
              new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey })
            );
          } catch (e) {
            console.warn("Profile picture delete failed:", e?.message || e);
          }
        }

        return res.json(rows[0]);
      }

      // 2) Validacija fajla (samo kad postoji)
      const parsedFile = fileSchema.safeParse({
        mimetype: req.file.mimetype,
        size: req.file.size,
      });
      if (!parsedFile.success) {
        return res.status(400).json({
          message: "Invalid file",
          errors: parsedFile.error.flatten(),
        });
      }

      if (!R2_PUBLIC_BASE_URL) {
        return res.status(500).json({
          message:
            "R2_PUBLIC_BASE_URL is not set. Set it to your r2.dev public bucket URL or your custom domain base URL.",
        });
      }

      const inputBuffer = req.file.buffer;

      // Resize + convert to webp
      const targetSize = 512;
      const compressedBuffer = await sharp(inputBuffer)
        .rotate()
        .resize({
          width: targetSize,
          height: targetSize,
          fit: "inside",
          withoutEnlargement: true,
        })
        .webp({ quality: 80 })
        .toBuffer();

      const newKey = `profile-pictures/${userId}/${randomUUID()}.webp`;
      const newUrl = `${R2_PUBLIC_BASE_URL}/${newKey}`;

      // 3) Upload u R2
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: newKey,
          Body: compressedBuffer,
          ContentType: "image/webp",
          CacheControl: "public, max-age=31536000, immutable",
        })
      );

      // 4) Updejtuj bazu
      const { rows } = await writePool.query(
        `
        UPDATE public.users
        SET image_url = $1, updated_at = NOW()
        WHERE id = $2
        RETURNING image_url
        `,
        [newUrl, userId]
      );

      // 5) Obriši staru sliku (best-effort)
      if (oldKey) {
        try {
          await s3.send(
            new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: oldKey })
          );
        } catch (e) {
          console.warn("Old profile picture delete failed:", e?.message || e);
        }
      }

      return res.json(rows[0]);
    } catch (err) {
      console.error("Profile picture upload error:", err);
      return res.status(500).json({ message: "Server error" });
    }
}

// SHEME
const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    full_name: z.string().min(1).max(120),
    description: z.string().min(0).max(150),
    eaes_member: z.boolean().optional().default(false)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

const updateUserSchema = z
  .object({
    full_name: z.string().min(1).max(120).optional(),
    description: z.string().max(2000).nullable().optional(),
    eaes_member: z.boolean().optional(),
  })
  .strict();

const passwordResetRequestSchema = z
  .object({
    email: z.string().email(),
  })
  .strict();

const verifySchema = z.object({
  email: z.string().email(),
  token: z.string().min(1).max(64),
}).strict();

const resetSchema = z.object({
  email: z.string().email(),
  token: z.string().min(1).max(64),
  newPassword: z.string().min(8),
}).strict();


// LIMITERI
export const resetRequestLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const ip = ipKeyGenerator(req);
    return `${ip}|${email}`;
  },
  message: { message: "Too many requests. Try again in 10 seconds." }
});

export const resetLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req),
  message: { message: "Too many requests. Try again in 10 seconds." }
});

export const resetVerifyLimiter = rateLimit({
  windowMs: 10 * 1000,
  limit: 1,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = (req.body?.email || "").toString().trim().toLowerCase();
    const token = (req.body?.token || "").toString().trim().toUpperCase();
    const ip = ipKeyGenerator(req);
    return `${ip}|${email}|${token}`;
  },
  message: { message: "Too many requests. Try again in 10 seconds." },
});


export async function handleRegister(req, res) {
    try{
        const {email, password, full_name, description, eaes_member} = registerSchema.parse(req.body);
        
        const emailNorm = email.trim().toLowerCase();
     
        //Proveravamo da li postoji
        const exists = await writePool.query("SELECT id FROM users WHERE lower(email) = $1",[emailNorm])
        if(exists.rowCount) {
          logEvent("auth.register_failed", { email: email,message: "Email already in use"});
          return res.status(409).json({message: "Email already in use"});
        }

        const saltRounds = Number(process.env.BCRYPT_ROUNDS || 12);
        const hash = await bcrypt.hash(password,saltRounds);

        const insert = 
        `INSERT INTO users (email, password_hash, full_name, description, eaes_member)
        VALUES ($1,$2,$3,$4,$5)
        RETURNING id, email, full_name, created_at, role, description, image_url, eaes_member`;

        const {rows} = await writePool.query(insert,[email,hash,full_name,description,eaes_member]);

        if (!rows.length) {
          logEvent("auth.register_failed", { email: email,message: "Email already in use"});
          return res.status(409).json({ message: "Email already in use" });         
        }
        const token = jwt.sign(
            {
                sub:rows[0].id,
                role: rows[0].role
            },
            process.env.JWT_SECRET,
            {expiresIn:process.env.JWT_EXPIRES || "7d"}
        );
        
        res.status(201).json({
            user: {email: rows[0].email, full_name: rows[0].full_name, role: rows[0].role, image_url: rows[0].image_url, description: rows[0].description, eaes_member: eaes_member},
            token,
        });
         logEvent("auth.register_success", { email: email,message: "User registered successfully"});
    }catch (err){
        if (err?.issues) return res.status(400).json({ message: "Invalid data", issues: err.issues });
            console.error(err);
        res.status(500).json({ message: "Server error" });
    }
}

export async function handleLogin(req, res) {
    try{
        const {email,password} = loginSchema.parse(req.body);
        const emailNorm = email.trim().toLowerCase();

        const { rows } = await writePool.query("SELECT id, email, password_hash, full_name, role, image_url, description, eaes_member FROM users WHERE lower(email) = $1",[emailNorm]);    
        if (!rows.length) {
          logEvent("auth.login_failed", { email: email, message: "No user" });
          return res.status(401).json({ message: "No account found with that email address." });
        }

        const user = rows[0];       
        const ok = await bcrypt.compare(password, user.password_hash);
        if (!ok) {
          logEvent("auth.login_failed", { email: email, message: "Wrong password" });
          return res.status(401).json({ message: "Invalid credentials" });
        }

        await writePool.query("UPDATE users SET last_login_at = NOW() WHERE id = $1", [user.id]);

        const token = jwt.sign(
            {
                sub: user.id,
                role: user.role
            },
            process.env.JWT_SECRET,
            {expiresIn:process.env.JWT_EXPIRES || "7d"}
        );
        res.status(201).json({
            user: {email: user.email, full_name: user.full_name, image_url: user.image_url, description: user.description, eaes_member: user.eaes_member, role: user.role},
            token,
        });
        logEvent("auth.login_success", { email: email, message: "User logged in" });
    } catch(err){
        if (err?.issues) return res.status(400).json({ message: "Invalid data", issues: err.issues });
            console.error(err);
        res.status(500).json({ message: "Server error" });
    }
}

export async function handlePasswordResetRequest(req, res) {
  const parsed = passwordResetRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      message: "Invalid input",
      errors: parsed.error.flatten(),
    });
  }

  const { email } = parsed.data;

  try {
    // 1) Find the user
    const { rows } = await writePool.query(`SELECT id FROM users WHERE email = $1`, [
      email,
    ]);

    // Always respond 200 (avoid leaking which emails exist)
    if (rows.length === 0) {
      logEvent("auth.pw_reset_req_failed", { email: email, message: "No user"});
      return res.json({
        message: "If that email is registered, you’ll receive reset instructions.",
      });
    }

    const userId = rows[0].id;

    // 2) Generate reset token & expiry
    const token = crypto.randomBytes(3).toString("hex").toUpperCase();
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + 1000 * 60 * 5);

    await writePool.query(
      `
      INSERT INTO password_resets(user_id, token, expires_at, created_at)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (user_id) WHERE used = FALSE
      DO UPDATE
        SET token      = EXCLUDED.token,
            expires_at = EXCLUDED.expires_at,
            created_at = EXCLUDED.created_at
      `,
      [userId, token, expiresAt, createdAt]
    );

    // 3) Fire n8n webhook to send email
    await axios.post(
      process.env.N8N_PASSWORD_RESET_URL,
      {
        email,
        resetToken: token,
        expiresAt,
      },
      {
        headers: {
          Authorization: process.env.N8N_SECRET,
          "Content-Type": "application/json",
        },
      }
    );

    logEvent("auth.pw_reset_req_success", { email: email, message: "Password reset sent"});
    return res.json({
      message: "If that email is registered, you’ll receive reset instructions.",
    });
  } catch (err) {
    console.error("Password reset request error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}



async function getResetRecord(token, email) {
  const { rows } = await writePool.query(
    `
    SELECT pr.user_id, pr.expires_at, pr.used
    FROM password_resets pr
    JOIN users u
      ON pr.user_id = u.id
     AND u.email   = $2
    WHERE pr.token = $1
    `,
    [token, email]
  );
  return rows[0] ?? null;
}

// 1) Verify token route
export async function handlePasswordResetVerify(req, res) {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({valid: false, message: "Invalid input", errors: parsed.error.flatten() });
  }

  try {
    const { token, email } = parsed.data;
    const rec = await getResetRecord(token, email);

    if (!rec || rec.used || new Date() > new Date(rec.expires_at)) {
      logEvent("auth.pw_reset_verification_failed", { email: email, message: "Invalid or expired reset token"});
      return res.status(400).json({ valid: false, message: "Invalid or expired reset token" });
    }

    return res.json({ valid: true });
  } catch (err) {
    console.error("Password reset verify error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}

// 2) Reset password route (tvoja postojeća logika)
export async function handlePasswordReset(req, res) {
  const parsed = resetSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ message: "Invalid input", errors: parsed.error.flatten() });
  }

  try {
    const { token, newPassword, email } = parsed.data;

    const rec = await getResetRecord(token, email);
    if (!rec || rec.used || new Date() > new Date(rec.expires_at)) {
      logEvent("auth.pw_reset_failed", { email: email, message: "Invalid or expired reset token"});
      return res.status(400).json({ message: "Invalid or expired reset token",changed: false });
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    await writePool.query(
      `
      UPDATE users
      SET password_hash = $1
      WHERE id = $2
      `,
      [newHash, rec.user_id]
    );

    await writePool.query(
      `
      UPDATE password_resets
      SET used = TRUE
      WHERE token = $1
      `,
      [token]
    );
    logEvent("auth.pw_reset_success", { email: email, message: "Password changed"});
    return res.json({ message: "Password has been reset. You can now log in.", changed: true});
  } catch (err) {
    console.error("Password reset error:", err);
    return res.status(500).json({ message: "Server error" });
  }
}


export async function handleGetMe(req, res) {
  try{
    const { rows } = await readPool.query("SELECT email, full_name, role, image_url, description, eaes_member, role FROM users WHERE id = $1",[req.user.sub]);   
    if (!rows.length) {
      // Ako token postoji, ali user je obrisan/ne postoji -> front može da odradi logout
      logEvent("auth.me_failed", { user_id: req.user.sub, message: "No user"});
      return res.status(401).json({
        message: "User does not exist",
      });
    }
    logEvent("auth.me_success", { user_id: req.user.sub, message: "Success"});
    res.json({user:rows[0]});
  }catch(error) {
      console.error('User Error:', error);
      res.status(500).json({ message: 'Failed to fetch user'});
  }
}

export async function handleUserUpdate(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const parsed = updateUserSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: parsed.error.flatten(),
      });
    }

    const { full_name, description, eaes_member } = parsed.data;

    // Ako nije poslato ništa za update
    if (
      typeof full_name === "undefined" &&
      typeof description === "undefined" &&
      typeof eaes_member === "undefined"
    ) {
      return res.status(400).json({ message: "No fields provided for update" });
    }

    const sql = `
      UPDATE public.users
      SET
        full_name    = COALESCE($1, full_name),
        description  = COALESCE($2, description),
        eaes_member  = COALESCE($3, eaes_member),
        updated_at   = NOW()
      WHERE id = $4
      RETURNING email, full_name, role, image_url, description, eaes_member;
    `;

    // Bitno: prosleđujemo null za "nije poslato", da COALESCE radi
    const values = [
      typeof full_name === "undefined" ? null : full_name,
      typeof description === "undefined" ? null : description,
      typeof eaes_member === "undefined" ? null : eaes_member,
      userId,
    ];

    const { rows } = await writePool.query(sql, values);

    if (rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    return res.json({user:rows[0]});
  } catch (err) {
    console.error("PATCH /user error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}



const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);


// 2) Jedna handler funkcija za sve providere
export async function handleOAuthLogin(req, res) {
  let client = null;
  const provider = String(req.params.provider || "").toLowerCase();

  if (provider !== "google") {
    return res.status(400).json({ message: `Unsupported provider: ${provider}` });
  }

  const code = req.body?.code;
  if (!code) {
    return res.status(400).json({ message: "Missing code" });
  }

  

  try {
    const { tokens } = await googleClient.getToken(code);

    if (!tokens) {
      return res.status(400).json({ message: "Failed to exchange code for tokens" });
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
      const response = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: {
          Authorization: `Bearer ${tokens.access_token}`,
        },
      });

      if (!response.ok) {
        return res.status(400).json({ message: "Failed to fetch Google user info" });
      }

      p = await response.json();
    }

    const provider_user_id = p?.sub;
    const email = (p?.email || "").toLowerCase();
    const full_name = p?.name || null;
    const picture = p?.picture || null;

    if (!provider_user_id || !email) {
      return res.status(400).json({ message: "Invalid Google token payload" });
    }

    const allowedHd = process.env.GOOGLE_ALLOWED_HD;
    if (allowedHd && p?.hd !== allowedHd) {
      return res.status(403).json({ message: "Google domain not allowed" });
    }
    client = await writePool.connect();
    await client.query("BEGIN");

    const idRes = await client.query(
      `
      SELECT u.id, u.email, u.full_name, u.role, u.image_url, u.description, u.eaes_member
      FROM public.auth_identities ai
      JOIN public.users u ON u.id = ai.user_id
      WHERE ai.provider = $1 AND ai.provider_user_id = $2
      LIMIT 1
      `,
      [provider, provider_user_id]
    );

    let userRow;
    let is_new_user = false;
    let linked_existing_account = false;

    if (idRes.rowCount) {
      userRow = idRes.rows[0];
    } else {
      const userRes = await client.query(
        `
        SELECT id, email, full_name, role, image_url, description, eaes_member
        FROM public.users
        WHERE lower(email) = $1
        LIMIT 1
        `,
        [email]
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
            [userRow.id, provider, provider_user_id, email]
          );
        } catch (e) {
          if (e?.code === "23505") {
            await client.query("ROLLBACK");
            return res.status(409).json({
              message: "This Google account is already linked to another user.",
              code: "PROVIDER_ALREADY_LINKED",
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
            RETURNING id, email, full_name, role, image_url, description, eaes_member
            `,
            [userRow.id, full_name, picture]
          );

          userRow = upd.rows[0];
        }
      } else {
        is_new_user = true;

        const saltRounds = Number(process.env.BCRYPT_ROUNDS || 12);
        const randomPass = crypto.randomBytes(32).toString("hex");
        const randomHash = await bcrypt.hash(randomPass, saltRounds);

        const insUser = await client.query(
          `
          INSERT INTO public.users (email, password_hash, full_name, image_url)
          VALUES ($1, $2, $3, $4)
          RETURNING id, email, full_name, role, image_url, description, eaes_member
          `,
          [email, randomHash, full_name, picture]
        );

        userRow = insUser.rows[0];

        await client.query(
          `
          INSERT INTO public.auth_identities (user_id, provider, provider_user_id, email)
          VALUES ($1, $2, $3, $4)
          `,
          [userRow.id, provider, provider_user_id, email]
        );
      }
    }

    await client.query(
      `
      UPDATE public.users
      SET last_login_at = NOW()
      WHERE id = $1
      `,
      [userRow.id]
    );

    await client.query("COMMIT");

    const token = jwt.sign(
      { sub: userRow.id, role: userRow.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES || "7d" }
    );

    return res.json({
      user: {
        email: userRow.email,
        full_name: userRow.full_name,
        role: userRow.role,
        image_url: userRow.image_url,
        description: userRow.description,
        eaes_member: userRow.eaes_member,
      },
      token,
      provider,
      is_new_user,
      linked_existing_account,
    });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error("OAuth login error:", err);
    return res.status(500).json({ message: "OAuth login failed" });
  } finally {
    if (client) client.release();
  }
}
