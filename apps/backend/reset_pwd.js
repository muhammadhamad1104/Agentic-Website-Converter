const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash('Muhammad11@H', 10);
  await prisma.user.update({
    where: { email: 'muhammadhamad1104@gmail.com' },
    data: { password: hash }
  });
  console.log('Password updated successfully');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
