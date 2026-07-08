const express = require('express');
const router = express.Router();
const { listPending, listAll, approve, reject } = require('./shopController');
const { authenticate, requireRole } = require('./authMiddleware');

router.use(authenticate, requireRole('admin'));

router.get('/pending', listPending);
router.get('/', listAll);
router.patch('/:id/approve', approve);
router.patch('/:id/reject', reject);

module.exports = router;
