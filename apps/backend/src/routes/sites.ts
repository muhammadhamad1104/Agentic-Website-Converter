import express from 'express';
import * as siteController from '../controllers/siteController';
import { requireAuth } from '../middleware/auth';
import { zipWebsiteUpload, uploadSiteZip } from '../controllers/sourceController';

const router = express.Router();

router.post('/validate-url', siteController.validateSiteUrl);
router.post('/upload-zip', requireAuth, zipWebsiteUpload, uploadSiteZip);
router.get('/', requireAuth, siteController.getSites);
router.post('/', requireAuth, siteController.createSite);
router.get('/:id', requireAuth, siteController.getSiteById);
router.delete('/:id', requireAuth, siteController.deleteSite);

export default router;
