import { z } from 'zod';

export const MOVEMENT_TYPES = [
  'PURCHASE_RECEIVED',
  'PURCHASE_RETURNED',
  'SALE_ISSUED',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'RETURN_RECEIVED',
  'INITIAL_BALANCE',
] as const;

export const INBOUND_MOVEMENT_TYPES = [
  'PURCHASE_RECEIVED',
  'RETURN_RECEIVED',
  'INITIAL_BALANCE',
] as const;

const stockIdentity = {
  warehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().max(64).optional(),
};

const actor = {
  referenceId: z.string().min(2),
  referenceType: z.string().min(1).optional(),
  createdBy: z.string().min(1).max(120).optional(),
};

export const increaseStockSchema = z.object({
  ...stockIdentity,
  ...actor,
  quantity: z.coerce.number().int().positive(),
  movementType: z.enum(INBOUND_MOVEMENT_TYPES).optional(),
  unitCost: z.coerce.number().nonnegative().optional(),
});

export const transferStockSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  productId: z.string().uuid(),
  variantId: z.string().max(64).optional(),
  ...actor,
  quantity: z.coerce.number().int().positive(),
});

export const receiveStockSchema = z.object({
  ...stockIdentity,
  ...actor,
  quantity: z.coerce.number().int().positive(),
  referenceType: z.string().min(1).default('PURCHASE_RECEIPT'),
  unitCost: z.coerce.number().nonnegative().optional(),
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

export const listMovementsQuerySchema = z.object({
  productId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  movementType: z.enum(MOVEMENT_TYPES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const TRANSFER_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;

export const listTransfersQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  status: z.enum(TRANSFER_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional(),
});

export const transferDecisionSchema = z.preprocess(
  (value) => (value == null || value === '' ? {} : value),
  z.object({
    note: z.string().max(500).nullish(),
  })
);
