import express from 'express';
import { requireAuth, requireAdmin , optionalAuth} from '../../middleware/auth.js';
import * as commentsController from './comments.controller.js';

const router = express.Router();

router.post('/post',requireAuth,commentsController.postComment)
router.get('/:id/replies',optionalAuth,commentsController.getReplies)
router.post("/:id/like", requireAuth, commentsController.handleLikeComment);
router.post("/:id/dislike", requireAuth, commentsController.handleDislikeComment);
router.patch("/:id/edit", requireAuth, commentsController.editComment);
router.delete("/:id/delete", requireAuth, commentsController.deleteComment);

export default router;