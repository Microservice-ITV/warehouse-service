import { Prisma, type SupplierStatus } from '@prisma/client';
import prisma from '@/config/database';
import { ConflictError, NotFoundError } from '@/utils/errors';

export class SupplierService {
  async list(params: { status?: SupplierStatus } = {}) {
    return prisma.supplier.findMany({
      where: params.status ? { status: params.status } : {},
      orderBy: { name: 'asc' },
    });
  }

  async get(id: string) {
    const supplier = await prisma.supplier.findUnique({ where: { id } });
    if (!supplier) throw new NotFoundError('Supplier not found');
    return supplier;
  }

  async create(input: {
    name: string;
    code?: string | null;
    contactName?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: string | null;
    paymentTerms?: string | null;
    taxNumber?: string | null;
    currency?: string;
    status?: 'ACTIVE' | 'INACTIVE';
  }) {
    return prisma.supplier.create({
      data: {
        name: input.name,
        code: input.code ?? null,
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        address: input.address ?? null,
        paymentTerms: input.paymentTerms ?? null,
        taxNumber: input.taxNumber ?? null,
        currency: input.currency ?? 'USD',
        status: input.status ?? 'ACTIVE',
      },
    });
  }

  async update(
    id: string,
    input: {
      name?: string;
      code?: string | null;
      contactName?: string | null;
      email?: string | null;
      phone?: string | null;
      address?: string | null;
      paymentTerms?: string | null;
      taxNumber?: string | null;
      currency?: string;
      status?: 'ACTIVE' | 'INACTIVE';
    }
  ) {
    await this.get(id);
    return prisma.supplier.update({ where: { id }, data: input });
  }

  async delete(id: string) {
    await this.get(id);
    try {
      await prisma.supplier.delete({ where: { id } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') {
        throw new ConflictError('This supplier has purchase history and cannot be deleted.');
      }
      throw error;
    }
  }
}