import * as authService from './auth.service.js';

export async function signupHandler(req, res) {
  const { user } = await authService.signup(req.body, { ip: req.ip });
  res.status(201).json({ user: user.toSafeJSON() });
}
