'use strict';

const ApiError = require('../utils/ApiError');

function validate(schema, source = 'body') {
  return (req, res, next) => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));
      return next(ApiError.badRequest('Validation failed', 'VALIDATION_ERROR', details));
    }
    if (source === 'query') {
      // Express 5 exposes a getter for req.query; store validated values separately.
      req.validatedQuery = result.data;
    } else {
      req[source] = result.data;
    }
    return next();
  };
}

module.exports = validate;
