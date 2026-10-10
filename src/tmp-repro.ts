import prisma from '@/config/database';

const main = async () => {
  try {
    const w = await prisma.warehouse.findMany();
    console.log('plain query ok:', w.length);
  } catch (e) {
    console.error('plain query FAIL:', (e as Error).message);
  }

  try {
    const r = await prisma.$transaction(async (tx) => {
      return tx.warehouse.findMany();
    });
    console.log('tx ok:', r.length);
  } catch (e) {
    console.error('tx FAIL:', (e as Error).message);
  }
};

main()
  .catch((e) => console.error('main FAIL:', e))
  .finally(() => prisma.$disconnect());
