import Joi from 'joi';

export const authSchema = {
  register: Joi.object({
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password: Joi.string().min(12).max(256).required(),
    name: Joi.string().trim().min(1).max(120).required()
  }),
  login: Joi.object({
    email: Joi.string().trim().lowercase().email().max(254).required(),
    password: Joi.string().required()
  }),
  forgotPassword: Joi.object({ email: Joi.string().trim().lowercase().email().max(254).required() }),
  resetPassword: Joi.object({
    token: Joi.string().pattern(/^[a-f0-9]{64}$/).required().messages({ 'string.pattern.base': 'This reset link is invalid or expired. Request a new one.' }),
    password: Joi.string().min(12).max(256).required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required().messages({ 'any.only': 'Passwords do not match.' }),
  }),
};
