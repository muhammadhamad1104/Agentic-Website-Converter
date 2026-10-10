import { Queue, Worker } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import { redis, bullmqConnection } from '../config/redis';
import { issuePasswordRecovery } from '../services/passwordRecovery';
import { recoveryConfiguration, sendPasswordChangedEmail } from '../services/recoveryMail';
import logger from '../utils/logger';

const prisma = new PrismaClient();
let queue: Queue | undefined;
let worker: Worker | undefined;
const getQueue = () => queue ||= new Queue('password-recovery', { connection: redis });
const options = { attempts: 3, backoff: { type: 'exponential', delay: 10000 }, removeOnComplete: true, removeOnFail: true };

export async function enqueueRecovery(email: string) {
  // All validated addresses are queued identically; account lookup happens off-request.
  await getQueue().add('request', { email }, options);
}

export async function enqueuePasswordChanged(userId: string) {
  if (recoveryConfiguration()) await getQueue().add('changed', { userId }, options);
}

export function startPasswordRecoveryWorker() {
  if (!recoveryConfiguration()) return;
  worker = new Worker('password-recovery', async job => {
    if (job.name === 'request') await issuePasswordRecovery(job.data.email);
    else if (job.name === 'changed') {
      const user = await prisma.user.findUnique({ where: { id: job.data.userId }, select: { email: true } });
      if (user) await sendPasswordChangedEmail(user.email);
    }
  }, { connection: bullmqConnection, concurrency: 2 });
  worker.on('failed', () => logger.warn('Account recovery email delivery failed; check SMTP configuration.'));
  worker.on('error', () => logger.warn('Account recovery queue is unavailable.'));
}

export async function closePasswordRecoveryQueue() {
  await worker?.close();
  await queue?.close();
}
