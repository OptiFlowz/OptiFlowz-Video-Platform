import { profilePictureUploadInternal } from './handlers/profilePictureUpload.js';
import { registerInternal } from './handlers/register.js';
import { loginInternal } from './handlers/login.js';
import { passwordResetRequestInternal } from './handlers/passwordResetRequest.js';
import { passwordResetVerifyInternal } from './handlers/passwordResetVerify.js';
import { passwordResetInternal } from './handlers/passwordReset.js';
import { getMeInternal } from './handlers/getMe.js';
import { userUpdateInternal } from './handlers/userUpdate.js';
import { oAuthLoginInternal } from './handlers/oAuthLogin.js';

export async function handleProfilePictureUpload(req, res) {
  try {
    const result = await profilePictureUploadInternal({ file: req.file }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleRegister(req, res) {
  try {
    const result = await registerInternal({ body: req.body });
    return res.status(201).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleLogin(req, res) {
  try {
    const result = await loginInternal({ body: req.body });
    return res.status(201).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handlePasswordResetRequest(req, res) {
  try {
    const result = await passwordResetRequestInternal({ body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handlePasswordResetVerify(req, res) {
  try {
    const result = await passwordResetVerifyInternal({ body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handlePasswordReset(req, res) {
  try {
    const result = await passwordResetInternal({ body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleGetMe(req, res) {
  try {
    const result = await getMeInternal(req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleUserUpdate(req, res) {
  try {
    const result = await userUpdateInternal({ body: req.body }, req.user?.sub || null);
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}

export async function handleOAuthLogin(req, res) {
  try {
    const result = await oAuthLoginInternal({ params: req.params, body: req.body });
    return res.status(200).json(result);
  } catch (error) {
    return res
      .status(error.status || 500)
      .json(error.body || { message: error.message || 'Internal server error' });
  }
}
