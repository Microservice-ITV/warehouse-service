import type { Request, Response } from 'express';
import { SupplierService } from '@/services/supplier.service';
import { ValidationError } from '@/utils/errors';
import { listSuppliersQuerySchema } from '@/validators/purchase.validators';

const supplierService = new SupplierService();

export const createSupplier = async (req: Request, res: Response) => {
  const supplier = await supplierService.create(req.body);
  return res.status(201).json({ success: true, data: supplier });
};

export const listSuppliers = async (req: Request, res: Response) => {
  const parsed = listSuppliersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    throw new ValidationError(parsed.error.errors.map((e) => e.message).join(', '));
  }
  const data = await supplierService.list(parsed.data);
  return res.status(200).json({ success: true, data });
};

export const getSupplier = async (req: Request, res: Response) => {
  const supplier = await supplierService.get(req.params.id);
  return res.status(200).json({ success: true, data: supplier });
};

export const updateSupplier = async (req: Request, res: Response) => {
  const supplier = await supplierService.update(req.params.id, req.body);
  return res.status(200).json({ success: true, data: supplier });
};