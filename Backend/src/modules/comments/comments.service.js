import { errors } from 'undici';
import {  readPool,writePool } from '../../database/index.js';
import { z } from "zod";

const postCommentSchema = z.object({
    video_id: z.string().uuid(),
    parent_id: z.string().uuid().nullable().optional(),
    content: z.string().trim().min(1).max(500),
}).strict();

export async function postComment(req , res){
    try {
        const user_id = req.user?.sub || null;
        const parsed = postCommentSchema.safeParse(req.body);

        if(!parsed.success){
            return res.status(400).json({message: "Invalid input", errors: parsed.error.flatten()});
        }

        const {video_id, parent_id=null,content} = parsed.data;

        const videoCheck = await writePool.query("SELECT id FROM public.videos WHERE id = $1 LIMIT 1",[video_id]);
        if(videoCheck.rowCount === 0){
            return res.status(404).json({message: "Video not found"});
        }

        if(parent_id){
            const parentCheck = await writePool.query("SELECT id,video_id FROM public.video_comments WHERE id = $1 AND video_id = $2 LIMIT 1",[parent_id,video_id])
            if(parentCheck.rowCount === 0){
                return res.status(404).json({message: "Parent comment not found"});
            }
        }

        const insertRes = await writePool.query(
            `
                INSERT INTO public.video_comments (video_id, user_id, parent_id, content)
                VALUES ($1,$2,$3,$4)
                RETURNING id, video_id, user_id, parent_id, content, like_count, dislike_count, reply_count, created_at, updated_at
            `,
            [video_id,user_id,parent_id,content]
        );

        return res.status(201).json({success: true, comment: insertRes.rows[0]});
    } catch (error) {
        console.log(error);
        return res.status(500).json({message: "Internal server error"});
    }
}

export async function getReplies(req, res) {
    try {
        const userId = req.user?.sub || null;
        if (!userId) return res.status(401).json({ message: "Unauthorized" });

        const parentId = req.params.id;
        if (!parentId) return res.status(400).json({ message: "Missing comment id" });

        const page = Math.max(parseInt(req.query.page || "1", 10), 1);
        const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 100);
        const offset = (page - 1) * limit;

        const sort = String(req.query.sort || "new").toLowerCase();
        const orderBy =
        sort === "top"
            ? "c.like_count DESC, c.created_at ASC"
            : "c.created_at ASC";

        // Parent comment mora postojati (ne moraš da vraćaš deleted)
        const parentRes = await readPool.query(
        `SELECT id, video_id FROM public.video_comments WHERE id = $1 AND is_deleted = false LIMIT 1`,
        [parentId]
        );
        if (parentRes.rowCount === 0) {
        return res.status(404).json({ message: "Parent comment not found" });
        }
        const video_id = parentRes.rows[0].video_id;

        // total replies (samo neobrisani)
        const countRes = await readPool.query(
        `
        SELECT COUNT(*)::int AS total
        FROM public.video_comments c
        WHERE c.parent_id = $1
            AND c.is_deleted = false
        `,
        [parentId]
        );
        const total = countRes.rows[0]?.total || 0;

        // fetch replies (samo neobrisani)
        const { rows } = await readPool.query(
        `
        SELECT
            c.id,
            c.video_id,
            c.user_id,
            c.parent_id,
            c.content,
            c.like_count,
            c.dislike_count,
            c.reply_count,
            c.created_at,
            c.updated_at,
            u.full_name AS author_full_name,
            u.image_url AS author_image_url,
            cr.reaction AS my_reaction
        FROM public.video_comments c
        JOIN public.users u ON u.id = c.user_id
        LEFT JOIN public.comment_reactions cr
            ON cr.comment_id = c.id AND cr.user_id = $2
        WHERE c.parent_id = $1
            AND c.is_deleted = false
        ORDER BY ${orderBy}
        LIMIT $3 OFFSET $4
        `,
        [parentId, userId, limit, offset]
        );

        return res.json({
        success: true,
        parent_id: parentId,
        video_id,
        page,
        limit,
        total,
        total_pages: Math.ceil(total / limit),
        replies: rows,
        });
    } catch (err) {
        console.error("getReplies error:", err);
        return res.status(500).json({ message: "Internal server error" });
    }
}


export async function handleLikeComment(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const commentId = req.params.id;
    const result = await setCommentReaction(commentId, userId, "like");
    return res.json(result);
  } catch (e) {
    console.error("handleLikeComment error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}

export async function handleDislikeComment(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const commentId = req.params.id;
    const result = await setCommentReaction(commentId, userId, "dislike");
    return res.json(result);
  } catch (e) {
    console.error("handleDislikeComment error:", e);
    return res.status(500).json({ message: "Server error" });
  }
}


export async function setCommentReaction(commentId, userId, reaction) {
  // reaction: "like" | "dislike"
  const client = await writePool.connect();
  const newVal = reaction === "like" ? 1 : -1;

  try {
    await client.query("BEGIN");

    // Proveri da komentar postoji + (opciono) da nije deleted
    const commentCheck = await client.query(
      `SELECT id FROM public.video_comments WHERE id = $1 AND is_deleted = false LIMIT 1`,
      [commentId]
    );
    if (commentCheck.rowCount === 0) {
      await client.query("ROLLBACK");
      return { status: 0, message: "Comment not found" };
    }

    // Zaključaj reakciju ako postoji
    const { rows } = await client.query(
      `SELECT reaction
       FROM public.comment_reactions
       WHERE comment_id = $1 AND user_id = $2
       FOR UPDATE`,
      [commentId, userId]
    );

    let status; // 1 liked, -1 disliked, 0 none

    if (rows.length === 0) {
      // Nema reakcije -> insert
      await client.query(
        `INSERT INTO public.comment_reactions (comment_id, user_id, reaction)
         VALUES ($1, $2, $3)`,
        [commentId, userId, newVal]
      );

      if (newVal === 1) {
        await client.query(
          `UPDATE public.video_comments
           SET like_count = like_count + 1
           WHERE id = $1`,
          [commentId]
        );
        status = 1;
      } else {
        await client.query(
          `UPDATE public.video_comments
           SET dislike_count = dislike_count + 1
           WHERE id = $1`,
          [commentId]
        );
        status = -1;
      }
    } else {
      const oldVal = rows[0].reaction;

      if (oldVal === newVal) {
        // Toggle OFF
        await client.query(
          `DELETE FROM public.comment_reactions
           WHERE comment_id = $1 AND user_id = $2`,
          [commentId, userId]
        );

        if (newVal === 1) {
          await client.query(
            `UPDATE public.video_comments
             SET like_count = GREATEST(like_count - 1, 0)
             WHERE id = $1`,
            [commentId]
          );
        } else {
          await client.query(
            `UPDATE public.video_comments
             SET dislike_count = GREATEST(dislike_count - 1, 0)
             WHERE id = $1`,
            [commentId]
          );
        }

        status = 0;
      } else {
        // Switch like <-> dislike
        await client.query(
          `UPDATE public.comment_reactions
           SET reaction = $3
           WHERE comment_id = $1 AND user_id = $2`,
          [commentId, userId, newVal]
        );

        if (newVal === 1) {
          // dislike -> like
          await client.query(
            `UPDATE public.video_comments
             SET like_count = like_count + 1,
                 dislike_count = GREATEST(dislike_count - 1, 0)
             WHERE id = $1`,
            [commentId]
          );
          status = 1;
        } else {
          // like -> dislike
          await client.query(
            `UPDATE public.video_comments
             SET dislike_count = dislike_count + 1,
                 like_count = GREATEST(like_count - 1, 0)
             WHERE id = $1`,
            [commentId]
          );
          status = -1;
        }
      }
    }

    // Vrati i nove count-ove (korisno za UI)
    const countsRes = await client.query(
      `SELECT like_count, dislike_count FROM public.video_comments WHERE id = $1`,
      [commentId]
    );

    await client.query("COMMIT");

    return {
      status, // 1 | -1 | 0
      like_count: countsRes.rows[0]?.like_count ?? 0,
      dislike_count: countsRes.rows[0]?.dislike_count ?? 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const editCommentSchema = z
  .object({
    content: z.string().trim().min(1).max(2000),
  }).strict();

export async function editComment(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const commentId = req.params.id;
    if (!commentId) return res.status(400).json({ message: "Missing comment id" });

    const parsed = editCommentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        message: "Invalid input",
        errors: parsed.error.flatten(),
      });
    }

    const { content } = parsed.data;

    // update samo ako je vlasnik + nije obrisan
    const { rows, rowCount } = await writePool.query(
      `
      UPDATE public.video_comments
      SET content = $1, updated_at = NOW()
      WHERE id = $2
        AND user_id = $3
        AND is_deleted = false
      RETURNING
        id, video_id, user_id, parent_id,
        content, like_count, dislike_count, reply_count,
        created_at, updated_at
      `,
      [content, commentId, userId]
    );

    if (rowCount === 0) {
      // može da bude: ne postoji, nije vlasnik, ili deleted
      // razlikuj poruke:
      const check = await writePool.query(
        `SELECT user_id, is_deleted FROM public.video_comments WHERE id = $1 LIMIT 1`,
        [commentId]
      );

      if (check.rowCount === 0) {
        return res.status(404).json({ message: "Comment not found" });
      }

      if (check.rows[0].is_deleted) {
        return res.status(400).json({ message: "Cannot edit deleted comment" });
      }

      if (check.rows[0].user_id !== userId) {
        return res.status(403).json({ message: "You can only edit your own comment" });
      }

      return res.status(400).json({ message: "Could not edit comment" });
    }

    return res.json({ success: true, comment: rows[0] });
  } catch (err) {
    console.error("editComment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}


export async function deleteComment(req, res) {
  try {
    const userId = req.user?.sub || null;
    if (!userId) return res.status(401).json({ message: "Unauthorized" });

    const commentId = req.params.id;
    if (!commentId) return res.status(400).json({ message: "Missing comment id" });

    // npr. req.user.role === "admin" ili req.user.is_admin === true
    const isAdmin = req.user?.role === "admin";

    // 1) učitaj owner + status
    const check = await writePool.query(
      `SELECT id, user_id, is_deleted FROM public.video_comments WHERE id = $1 LIMIT 1`,
      [commentId]
    );

    if (check.rowCount === 0) {
      return res.status(404).json({ message: "Comment not found" });
    }

    const comment = check.rows[0];

    if (comment.is_deleted) {
      // idempotentno: već obrisan
      return res.json({ success: true, deleted: true });
    }

    const isOwner = comment.user_id === userId;

    if (!isOwner && !isAdmin) {
      return res.status(403).json({ message: "You can only delete your own comment (or be admin)" });
    }

    // 2) soft delete
    await writePool.query(
      `
      UPDATE public.video_comments
      SET is_deleted = true,
          updated_at = NOW()
      WHERE id = $1
      `,
      [commentId]
    );

    return res.json({ success: true, deleted: true });
  } catch (err) {
    console.error("deleteComment error:", err);
    return res.status(500).json({ message: "Internal server error" });
  }
}