import { sendSuccess, sendError } from '../../common/response.js';
import { getVideoNotesInternal } from './handlers/getVideoNotes.js';
import { createNoteInternal } from './handlers/createNote.js';
import { editNoteInternal } from './handlers/editNote.js';
import { deleteNoteInternal } from './handlers/deleteNote.js';

export async function getVideoNotes(req, res) {
  try {
    const result = await getVideoNotesInternal(req.params, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('getVideoNotes error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function createNote(req, res) {
  try {
    const note = await createNoteInternal(req.body, req.user?.sub);
    return sendSuccess(res, { note }, 201);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('createNote error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function editNote(req, res) {
  try {
    const note = await editNoteInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { note });
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('editNote error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deleteNote(req, res) {
  try {
    const result = await deleteNoteInternal(req.params, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    if (!error.status || error.status >= 500) console.error('deleteNote error:', error);
    return sendError(res, error.message, error.status || 500);
  }
}
