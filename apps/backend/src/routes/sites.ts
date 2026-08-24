import express from 'express';
import * as siteController from '../controllers/siteController';
import { requireAuth } from '../middleware/auth';

const router = express.Router();

router.post('/validate-url', siteController.validateSiteUrl);
router.get('/', requireAuth, siteController.getSites);
router.post('/', requireAuth, siteController.createSite);
router.get('/:id', requireAuth, siteController.getSiteById);
router.delete('/:id', requireAuth, siteController.deleteSite);

export default router;
