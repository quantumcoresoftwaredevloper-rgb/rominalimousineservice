import { Router } from 'express';
import { protect, requirePermission } from '../middleware/auth.js';
import { audit } from '../middleware/audit.js';
import * as admin from '../controllers/adminController.js';
import * as crm from '../controllers/crmController.js';

const router = Router();
// All CRM routes require authentication; each route then names the exact
// permission it needs. A role added to the staff set never inherits access by
// omission — see server/src/utils/roles.js.
router.use(protect);

router.get('/analytics', requirePermission('analytics.read'), admin.analytics);
router.get('/analytics/timeseries', requirePermission('analytics.read'), crm.timeseries);
router.get('/analytics/heatmap', requirePermission('analytics.read'), crm.heatmap);

router.get('/rides', requirePermission('rides.read'), admin.rides);
router.patch('/rides/:id/dispatch', requirePermission('rides.dispatch'), audit('rides.dispatch', { targetType: 'Ride' }), admin.assignDriver);
router.patch('/rides/:id', requirePermission('rides.update'), audit('rides.update', { targetType: 'Ride' }), admin.updateRide);
router.post('/rides/:id/no-show', requirePermission('rides.update'), audit('rides.no_show', { targetType: 'Ride' }), crm.markNoShow);

router.get('/drivers', requirePermission('drivers.read'), admin.drivers);
router.get('/fleet/vehicles', requirePermission('fleet.read'), crm.listVehicles);
router.post('/fleet/vehicles', requirePermission('fleet.write'), audit('fleet.createVehicle', { targetType: 'Vehicle' }), crm.createVehicle);
router.patch('/fleet/vehicles/:id', requirePermission('fleet.write'), audit('fleet.updateVehicle', { targetType: 'Vehicle' }), crm.updateVehicle);
router.delete('/fleet/vehicles/:id', requirePermission('fleet.write'), audit('fleet.deleteVehicle', { targetType: 'Vehicle' }), crm.deleteVehicle);

router.get('/users', requirePermission('users.read'), admin.users);
router.post('/users', requirePermission('users.write'), audit('users.create', { targetType: 'User' }), admin.createUser);
router.patch('/users/:id/suspend', requirePermission('users.write'), audit('users.suspend', { targetType: 'User' }), admin.suspendUser);
router.patch('/users/:id/unsuspend', requirePermission('users.write'), audit('users.unsuspend', { targetType: 'User' }), admin.unsuspendUser);
router.patch('/users/:id', requirePermission('users.write'), audit('users.update', { targetType: 'User' }), admin.updateUser);
router.delete('/users/:id', requirePermission('users.write'), audit('users.delete', { targetType: 'User' }), admin.deleteUser);

router.get('/payments', requirePermission('payments.read'), admin.payments);

router.get('/content', requirePermission('content.read'), admin.listContent);
router.patch('/content', requirePermission('content.write'), audit('content.update'), admin.updateContent);

router.get('/passengers', requirePermission('passengers.read'), crm.listPassengers);
router.get('/passengers/:id', requirePermission('passengers.read'), crm.getPassenger);
router.get('/operations/live', requirePermission('ops.live'), crm.liveOps);

router.get('/tickets', requirePermission('tickets.read'), crm.listTickets);
router.post('/tickets', requirePermission('tickets.write'), audit('tickets.create', { targetType: 'Ticket' }), crm.createTicket);
router.patch('/tickets/:id', requirePermission('tickets.write'), audit('tickets.update', { targetType: 'Ticket' }), crm.updateTicket);

router.get('/audit', requirePermission('audit.read'), crm.listAudit);

export default router;
