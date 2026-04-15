import express from 'express';
import { requireAuth, requireAdmin } from '../../middleware/auth.js';
import { getReplies, handleLikeComment, handleDislikeComment, editComment, deleteComment} from './comments.service.js';
import * as channelController from './comments.controller.js';


const router = express.Router();


router.post('/post',requireAuth,channelController.postComment)
router.get('/:id/replies',requireAuth,getReplies)
router.post("/:id/like", requireAuth, handleLikeComment);
router.post("/:id/dislike", requireAuth, handleDislikeComment);
router.patch("/:id/edit", requireAuth, editComment);
router.delete("/:id/delete", requireAuth, deleteComment);

export default router;