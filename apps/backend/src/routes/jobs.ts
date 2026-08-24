import express from 'express';
import * as jobController from '../controllers/jobController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.post('/', requireAuth, jobController.createJob);
router.get('/:id', requireAuth, jobController.getJobStatus);
router.post('/:id/run', requireAuth, jobController.runJob);
router.post('/:id/infer-schema', requireAuth, jobController.inferSchema);
router.post('/:id/schema-decision', requireAuth, jobController.submitSchemaDecision);
router.post('/:id/export', requireAuth, jobController.exportJob);
router.get('/:id/download', requireAuth, jobController.downloadJobZip);

export default router;

