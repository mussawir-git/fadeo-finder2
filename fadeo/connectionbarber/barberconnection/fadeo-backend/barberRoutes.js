const express = require('express');
const router = express.Router();
const {
  listBarbers, createBarber, updateBarber, deleteBarber, getAttendance, setAttendance,
} = require('./barberController');
const { authenticate, requireRole } = require('./authMiddleware');

// Public — anyone browsing the marketplace can see a shop's barbers and
// today's attendance (that's the whole point: absent barbers show up here).
router.get('/shops/:shopId/barbers', listBarbers);
router.get('/shops/:shopId/attendance', getAttendance);

// Owner-only — managing your own shop's roster and attendance.
router.post('/shops/:shopId/barbers', authenticate, requireRole('owner'), createBarber);
router.patch('/barbers/:id', authenticate, requireRole('owner'), updateBarber);
router.delete('/barbers/:id', authenticate, requireRole('owner'), deleteBarber);
router.patch('/barbers/:id/attendance', authenticate, requireRole('owner'), setAttendance);

module.exports = router;
