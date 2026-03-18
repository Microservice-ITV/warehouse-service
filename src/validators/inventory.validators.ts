import { z } from 'zod';

export const increaseStockSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  referenceId: z.string().min(2),
});

export const adjustStockSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().refine((value) => value !== 0, 'quantity cannot be 0'),
  referenceId: z.string().min(2),
});

export const validateProductStockSchema = z.object({
  items: z
    .array(
      z.object({
        product_id: z.string().uuid(),
        qty: z.coerce.number().int().positive(),
      })
    )
    .min(1),
});

export const transferStockSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  referenceId: z.string().min(2),
});

export const countStockSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  countedQty: z.coerce.number().int().min(0),
  referenceId: z.string().min(2),
});

export const receiveStockSchema = z.object({
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  referenceType: z.string().min(1).default('PO'),
  referenceId: z.string().min(2),
});
