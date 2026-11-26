'use strict';

const mongoose = require('mongoose');
const multer = require('multer');
const ApiError = require('../utils/ApiError');
const config = require('../config/env');
const logger = require('../config/logger');
const fs = require('node:fs/promises');
const path = require('node:path');

function notFoundHandler(req, res, next) {
  next(ApiError.notFound(`Route ${req.method} ${req.originalUrl} does not exist`));
}

function errorHandler(error, req, res, next) {
  if (req.file?.path && !req.fileSaved) {
    const root = path.resolve(config.MEDIA_STORAGE_DIR) + path.sep;
    const file = path.resolve(req.file.path);
    if (file.startsWith(root)) fs.unlink(file).catch(() => {});
  }
  if (res.headersSent) return next(error);

  let status = error.status || error.statusCode || 500;
  let code = error.code || 'INTERNAL_ERROR';
  let message = error.expose ? error.message : 'Something went wrong';
  let details = error.details;

  if (error instanceof multer.MulterError) {
    status = 400;
    code = error.code === 'LIMIT_FILE_SIZE' ? 'FILE_TOO_LARGE' : 'UPLOAD_ERROR';
    message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the ${config.MAX_UPLOAD_MB} MB upload limit`
        : error.message;
  } else if (error.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Request body is not valid JSON';
  } else if (error instanceof mongoose.Error.ValidationError) {
    status = 400;
    code = 'DATABASE_VALIDATION_ERROR';
    message = 'One or more fields are invalid';
    details = Object.values(error.errors).map((item) => item.message);
  } else if (error.name === 'CastError') {
    status = 400;
    code = 'INVALID_ID';
    message = 'Invalid identifier';
  } else if (error.code === 11000) {
    status = 409;
    code = 'DUPLICATE';
    message = 'That value is already in use';
  }

  if (status >= 500) {
    logger.error({ err: error, reqId: req.id, path: req.originalUrl }, 'Unhandled request error');
  }

  res.status(status).json({
    error: {
      code,
      message,
      ...(details ? { details } : {}),
      ...(req.id ? { requestId: req.id } : {}),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
