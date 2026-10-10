import express from 'express';
import * as jobController from '../controllers/jobController';
import { preview } from '../controllers/previewController';
import { requireAuth, requireJobAccess } from '../middleware/auth';

const router = express.Router();

router.post('/', requireAuth, jobController.createJob);
router.use('/:id', requireAuth, requireJobAccess);
router.post('/:id/preview/:lease', preview);
router.put('/:id/preview/:lease', preview);
router.delete('/:id/preview/:lease', preview);
router.get('/:id', requireAuth, jobController.getJobStatus);
router.post('/:id/run', requireAuth, jobController.runJob);
router.post('/:id/infer-schema', requireAuth, jobController.inferSchema);
router.post('/:id/schema-decision', requireAuth, jobController.submitSchemaDecision);
router.post('/:id/export', requireAuth, jobController.exportJob);
router.get('/:id/download', requireAuth, jobController.downloadJobZip);

export default router;
