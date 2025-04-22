// crypto-bot/middleware/validate.js
const Joi = require("joi");

const validate = (schema) => (req, res, next) => {
  if (!schema) return next();

  const validSchemaKeys = ["params", "query", "body"];
  const validationOptions = {
    abortEarly: false,
    stripUnknown: true,
    errors: { label: "key" },
  };

  // Validate request parts according to schema
  const validationErrors = validSchemaKeys
    .filter((key) => schema[key])
    .map((key) => {
      const { error, value } = schema[key].validate(
        req[key],
        validationOptions
      );

      if (value) {
        req[key] = value;
      }

      return error ? { key, error } : null;
    })
    .filter(Boolean);

  if (validationErrors.length === 0) {
    return next();
  }

  // Format validation errors
  const errorDetails = validationErrors.flatMap(({ error }) =>
    error.details.map((detail) => detail.message)
  );

  return res.status(400).json({
    errors: errorDetails,
    message: "Validation failed",
  });
};

module.exports = validate;
