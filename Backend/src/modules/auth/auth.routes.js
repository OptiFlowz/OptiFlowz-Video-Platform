import express from 'express';
import { requireAuth } from '../../middleware/auth.js';
import {
  profilePictureUploadMiddleware,
  resetLimiter,
  resetRequestLimiter,
  resetVerifyLimiter,
  handleProfilePictureUpload,
  handleRegister,
  handleLogin,
  handlePasswordResetRequest,
  handlePasswordResetVerify,
  handlePasswordReset,
  handleGetMe,
  handleUserUpdate,
  handleOAuthLogin,
} from './auth.service.js';

const router = express.Router();

router.post('/user/profile-picture', requireAuth, profilePictureUploadMiddleware, handleProfilePictureUpload);
router.post('/register', handleRegister);
router.post('/login', handleLogin);
router.post('/passwordResetRequest', resetRequestLimiter, handlePasswordResetRequest);
router.post('/passwordReset/verify', resetVerifyLimiter, handlePasswordResetVerify);
router.post('/passwordReset', resetLimiter, handlePasswordReset);
router.get('/me', requireAuth, handleGetMe);
router.patch('/user-update', requireAuth, handleUserUpdate);
router.post('/oauth/:provider', handleOAuthLogin);

export default router;
