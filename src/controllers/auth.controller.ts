import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AuthRequest } from '../middlewares/auth.middleware';

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET || 'grambi_super_secret_jwt_key_2026';

const RegisterSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(1),
  businessName: z.string().min(1),
  phoneNumberId: z.string().min(1),
  wabaId: z.string().optional(),
  accessToken: z.string().min(1),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
});

export const register = async (req: Request, res: Response) => {
  const result = RegisterSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: result.error.format() });
  }

  const { email, password, businessName, phoneNumberId, wabaId, accessToken } = result.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(400).json({ error: 'An account with this email already exists.' });
  }

  const hashedPassword = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      password: hashedPassword,
      businessName,
      phoneNumberId,
      wabaId: wabaId || null,
      accessToken,
    },
  });

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

  return res.status(201).json({
    message: 'Account created successfully!',
    token,
    user: {
      id: user.id,
      email: user.email,
      businessName: user.businessName,
      phoneNumberId: user.phoneNumberId,
    },
  });
};

export const login = async (req: Request, res: Response) => {
  const result = LoginSchema.safeParse(req.body);
  if (!result.success) {
    return res.status(400).json({ error: 'Invalid email or password format.' });
  }

  const { email, password } = result.data;

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const isMatch = await bcrypt.compare(password, user.password);
  if (!isMatch) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });

  return res.json({
    message: 'Login successful!',
    token,
    user: {
      id: user.id,
      email: user.email,
      businessName: user.businessName,
      phoneNumberId: user.phoneNumberId,
    },
  });
};

export const getProfile = async (req: AuthRequest, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: {
      id: true,
      email: true,
      businessName: true,
      phoneNumberId: true,
      wabaId: true,
      walletBalance: true,
      pricePerMessage: true,
      createdAt: true,
    },
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found.' });
  }

  return res.json(user);
};
