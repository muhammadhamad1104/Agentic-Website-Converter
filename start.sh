#!/bin/bash
export BUILDX_NO_DEFAULT_ATTESTATIONS=1
export DOCKER_BUILDKIT=0
echo "Starting docker containers..."
docker compose up -d --build

echo "Waiting for database to initialize (15 seconds)..."
sleep 15

echo "Pushing Prisma schema to database..."
docker compose exec backend npx prisma db push

echo "Seeding the database..."
docker compose exec backend npm run seed

echo "All done! Project is running locally."
