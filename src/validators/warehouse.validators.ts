import { z } from 'zod';

export const createWarehouseSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(2).max(120),
  location: z.string().max(255).optional(),
  isDefault: z.boolean().optional(),
});

export const updateWarehouseSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    location: z.string().max(255).nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');
