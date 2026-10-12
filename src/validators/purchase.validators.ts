import { z } from 'zod';

const ORDER_STATUSES = [
  'DRAFT',
  'PENDING_APPROVAL',
  'PENDING',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
] as const;

const RECEIPT_STATUSES = ['DRAFT', 'POSTED', 'CANCELLED'] as const;

const ALLOCATION_METHODS = ['QUANTITY', 'WEIGHT', 'VOLUME', 'VALUE', 'MANUAL'] as const;
const ADDITIONAL_COST_CATEGORIES = [
  'HANDLING',
  'CUSTOMS',
  'INSURANCE',
  'TAX',
  'FREIGHT',
  'OTHER',
] as const;
const COST_STATUSES = ['ESTIMATED', 'ACTUAL'] as const;
const COST_ADJUSTMENT_TYPES = ['FREIGHT', 'INVOICE', 'OTHER'] as const;

export const createSupplierSchema = z.object({
  name: z.string().min(2).max(120),
  code: z.string().max(60).nullable().optional(),
  contactName: z.string().max(120).nullable().optional(),
  email: z.string().email().max(160).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  address: z.string().max(255).nullable().optional(),
  paymentTerms: z.string().max(120).nullable().optional(),
  taxNumber: z.string().max(60).nullable().optional(),
  currency: z.string().length(3).optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

export const updateSupplierSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    code: z.string().max(60).nullable().optional(),
    contactName: z.string().max(120).nullable().optional(),
    email: z.string().email().max(160).nullable().optional(),
    phone: z.string().max(40).nullable().optional(),
    address: z.string().max(255).nullable().optional(),
    paymentTerms: z.string().max(120).nullable().optional(),
    taxNumber: z.string().max(60).nullable().optional(),
    currency: z.string().length(3).optional(),
    status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'At least one field must be provided');

export const listSuppliersQuerySchema = z.object({
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});

const purchaseOrderItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().max(120).optional(),
  sku: z.string().max(120).nullable().optional(),
  productName: z.string().max(255).nullable().optional(),
  description: z.string().max(255).nullable().optional(),
  unit: z.string().max(40).nullable().optional(),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
  discountAmount: z.number().nonnegative().optional(),
  weightPerUnit: z.number().nonnegative().optional(),
  volumePerUnit: z.number().nonnegative().optional(),
});

const deliveryStageBaseSchema = z.object({
  sequence: z.number().int().positive().optional(),
  name: z.string().min(1).max(120),
  carrier: z.string().max(120).nullable().optional(),
  feeAmount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  allocationMethod: z.enum(ALLOCATION_METHODS).optional(),
  applicableProductIds: z.array(z.string()).optional(),
  notes: z.string().max(500).nullable().optional(),
});

const additionalCostBaseSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum(ADDITIONAL_COST_CATEGORIES).optional(),
  amount: z.number().nonnegative(),
  currency: z.string().length(3).optional(),
  allocationMethod: z.enum(ALLOCATION_METHODS).optional(),
  status: z.enum(COST_STATUSES).optional(),
  applicableProductIds: z.array(z.string()).optional(),
  notes: z.string().max(500).nullable().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  currency: z.string().length(3).optional(),
  exchangeRate: z.number().positive().optional(),
  paymentTerms: z.string().max(120).nullable().optional(),
  deliveryTerms: z.string().max(120).nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  supplierContact: z.string().max(300).nullable().optional(),
  orderDate: z.string().datetime().nullable().optional(),
  expectedAt: z.string().datetime().nullable().optional(),
  discountAmount: z.number().nonnegative().optional(),
  taxAmount: z.number().nonnegative().optional(),
  shippingAmount: z.number().nonnegative().optional(),
  items: z.array(purchaseOrderItemSchema).min(1),
  deliveryStages: z.array(deliveryStageBaseSchema).optional(),
  additionalCosts: z.array(additionalCostBaseSchema).optional(),
  attachments: z
    .array(
      z.object({
        fileName: z.string().min(1).max(255),
        mimeType: z.string().min(1).max(150),
        sizeBytes: z.number().int().positive().max(4 * 1024 * 1024),
        contentBase64: z.string().min(1).max(8_000_000),
      }),
    )
    .max(5)
    .optional(),
});

export const updatePurchaseOrderStatusSchema = z.object({
  status: z.enum(ORDER_STATUSES),
  note: z.string().max(500).optional(),
});

export const listPurchaseOrdersQuerySchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export const createDeliveryStageSchema = deliveryStageBaseSchema;
export const createAdditionalCostSchema = additionalCostBaseSchema;

export const createCostAdjustmentSchema = z.object({
  type: z.enum(COST_ADJUSTMENT_TYPES).optional(),
  amount: z.number(),
  currency: z.string().length(3).optional(),
  allocationMethod: z.enum(ALLOCATION_METHODS).optional(),
  reason: z.string().max(500).nullable().optional(),
});

export const listDeliveryStagesQuerySchema = z.object({
  allocationMethod: z.enum(ALLOCATION_METHODS).optional(),
});

export const listAdditionalCostsQuerySchema = z.object({
  status: z.enum(COST_STATUSES).optional(),
  category: z.enum(ADDITIONAL_COST_CATEGORIES).optional(),
});

export const listCostAdjustmentsQuerySchema = z.object({
  type: z.enum(COST_ADJUSTMENT_TYPES).optional(),
  isApplied: z.coerce.boolean().optional(),
});

const purchaseReceiptItemSchema = z.object({
  purchaseOrderItemId: z.string().uuid().optional(),
  productId: z.string().uuid(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
  acceptedQty: z.number().int().nonnegative().optional(),
  rejectedQty: z.number().int().nonnegative().optional(),
  unitCost: z.number().nonnegative(),
  batchNumber: z.string().max(120).nullable().optional(),
  expiryAt: z.string().datetime().nullable().optional(),
});

export const createPurchaseReceiptSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  warehouseId: z.string().uuid().optional(),
  notes: z.string().max(1000).nullable().optional(),
  createdBy: z.string().max(120).optional(),
  items: z.array(purchaseReceiptItemSchema).min(1),
});

export const listPurchaseReceiptsQuerySchema = z.object({
  purchaseOrderId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(RECEIPT_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

const purchaseReturnItemSchema = z.object({
  productId: z.string().uuid(),
  variantId: z.string().optional(),
  quantity: z.number().int().positive(),
  unitCost: z.number().nonnegative(),
});

export const createPurchaseReturnSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  purchaseOrderId: z.string().uuid().nullable().optional(),
  reason: z.string().max(1000).nullable().optional(),
  createdBy: z.string().max(120).optional(),
  items: z.array(purchaseReturnItemSchema).min(1),
});

export const listPurchaseReturnsQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  status: z.enum(RECEIPT_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type CreatePurchaseOrderInput = z.infer<typeof createPurchaseOrderSchema>;
export type UpdatePurchaseOrderStatusInput = z.infer<typeof updatePurchaseOrderStatusSchema>;
export type CreateDeliveryStageInput = z.infer<typeof createDeliveryStageSchema>;
export type CreateAdditionalCostInput = z.infer<typeof createAdditionalCostSchema>;
export type CreateCostAdjustmentInput = z.infer<typeof createCostAdjustmentSchema>;
export type CreatePurchaseReceiptInput = z.infer<typeof createPurchaseReceiptSchema>;
export type CreatePurchaseReturnInput = z.infer<typeof createPurchaseReturnSchema>;
