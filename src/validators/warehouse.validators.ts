import { z } from 'zod';

export const createWarehouseSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(40).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  managerUserId: z.string().uuid().optional(),
});

export const updateWarehouseSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    code: z.string().max(40).nullable().optional(),
    address: z.string().max(255).nullable().optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const listWarehousesQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  catalog: z.enum(['true', '1']).optional(),
  includePurchased: z.enum(['true', '1']).optional(),
});
