import { getPersonByIdInternal } from './handlers/getPersonById.js';
import { searchPeopleInternal } from './handlers/searchPeople.js';
import { createPersonInternal } from './handlers/createPerson.js';
import { uploadPersonImageInternal } from './handlers/uploadPersonImage.js';
import { updatePersonDetailsInternal } from './handlers/updatePersonDetails.js';
import { deletePersonInternal } from './handlers/deletePerson.js';
import { getAllPeopleInternal } from './handlers/getAllPeople.js';
import { sendSuccess, sendError } from '../../common/response.js';

export async function getPersonById(req, res) {
  try {
    const person = await getPersonByIdInternal(req.params);

    if (!person) {
      return sendError(res, 'Person not found', 404);
    }

    return sendSuccess(res, { person });
  } catch (error) {
    console.error('Error fetching person by id:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function searchPeople(req, res) {
  try {
    const result = await searchPeopleInternal(req.query);
    return sendSuccess(res, result);
  } catch (error) {
    console.error('Error searching people:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function createPerson(req, res) {
  try {
    const person = await createPersonInternal(req.body, req.user?.sub);

    return sendSuccess(res, { person }, 201);
  } catch (error) {
    console.error('Error creating person:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function uploadPersonImage(req, res) {
  try {
    const person = await uploadPersonImageInternal(req.params, req.file, req.user?.sub);
    return sendSuccess(res, { person });
  } catch (error) {
    console.error('Error uploading person image:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function updatePersonDetails(req, res) {
  try {
    const person = await updatePersonDetailsInternal(req.params, req.body, req.user?.sub);
    return sendSuccess(res, { person });
  } catch (error) {
    console.error('Error updating person details:', error);
    return sendError(res, error.message, error.status || 500);
  }
}

export async function deletePerson(req, res) {
  try {
    const result = await deletePersonInternal(req.params, req.user?.sub);
    return sendSuccess(res, result);
  } catch (error) {
    console.error('Error deleting person:', error);
    return sendError(res, error.message, error.status || 500);
  }
}


export async function getAllPeople(req, res) {
  try {
    const result = await getAllPeopleInternal(req.query);
    return sendSuccess(res, result);
  } catch (error) {
    console.error('Error fetching people:', error);
    return sendError(res, error.message, error.status || 500);
  }
}