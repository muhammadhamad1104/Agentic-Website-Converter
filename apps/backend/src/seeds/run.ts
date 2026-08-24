import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_ADMIN_EMAIL || 'admin@example.com';
  const password = process.env.SEED_ADMIN_PASSWORD || 'changeme123';

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    console.log(`User ${email} already exists.`);
  } else {
    const passwordHash = await argon2.hash(password);
    
    await prisma.user.create({
      data: {
        name: 'Muhammad Hamad',
        email,
        passwordHash,
        role: 'OWNER',
      }
    });
    console.log(`User ${email} seeded successfully.`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
