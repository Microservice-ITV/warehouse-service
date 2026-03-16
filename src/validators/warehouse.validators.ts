import { z } from 'zod';

export const createWarehouseSchema = z.object({
  shopId: z.string().uuid(),
  name: z.string().min(2).max(120),
  location: z.string().max(255).optional(),
});
