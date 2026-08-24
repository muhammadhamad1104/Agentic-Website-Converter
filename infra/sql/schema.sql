-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- This file is mainly for reference
-- Actual schema is managed by Prisma migrations in backend
-- See: apps/backend/prisma/schema.prisma

-- Basic health check table
CREATE TABLE IF NOT EXISTS system_health (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    service VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL,
    last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO system_health (service, status) VALUES ('database', 'healthy');
