import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const crawls = await prisma.crawl.findMany({
    where: { startUrl: { contains: "nowwadvisory" } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, status: true, assetsDiscovered: true, logRef: true, createdAt: true }
  });
  console.log(crawls);
}
main().catch(console.error).finally(() => prisma.$disconnect());
