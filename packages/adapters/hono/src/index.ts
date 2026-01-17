/**
 * OpenMDM Hono Adapter
 *
 * HTTP routes adapter for Hono framework.
 *
 * @example
 * ```typescript
 * import { Hono } from 'hono';
 * import { createMDM } from '@openmdm/core';
 * import { honoAdapter } from '@openmdm/hono';
 *
 * const mdm = createMDM({ ... });
 * const app = new Hono<MDMEnv>();
 *
 * // Mount MDM routes
 * app.route('/mdm', honoAdapter(mdm));
 * ```
 */

import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { Context, MiddlewareHandler, Env } from 'hono';
import type {
  MDMInstance,
  EnrollmentRequest,
  Heartbeat,
  DeviceFilter,
  CommandFilter,
  CreatePolicyInput,
  UpdatePolicyInput,
  CreateApplicationInput,
  UpdateApplicationInput,
  CreateGroupInput,
  UpdateGroupInput,
  SendCommandInput,
  MDMError,
  AuthenticationError,
  AuthorizationError,
} from '@openmdm/core';

/**
 * Context variables set by OpenMDM middlewares
 */
interface MDMVariables {
  deviceId?: string;
  user?: unknown;
}

/**
 * Hono environment type for OpenMDM routes
 */
type MDMEnv = {
  Variables: MDMVariables;
};

export interface HonoAdapterOptions {
  /**
   * Base path prefix for all routes (default: '')
   */
  basePath?: string;

  /**
   * Enable authentication middleware for admin routes
   */
  enableAuth?: boolean;

  /**
   * Custom error handler
   */
  onError?: (error: Error, c: Context) => Response | Promise<Response>;

  /**
   * Routes to expose (default: all)
   */
  routes?: {
    enrollment?: boolean;
    devices?: boolean;
    policies?: boolean;
    applications?: boolean;
    groups?: boolean;
    commands?: boolean;
    events?: boolean;
  };
}

/**
 * Create a Hono router with OpenMDM API routes
 */
export function honoAdapter(
  mdm: MDMInstance,
  options: HonoAdapterOptions = {}
): Hono<MDMEnv> {
  const app = new Hono<MDMEnv>();

  const routes = {
    enrollment: true,
    devices: true,
    policies: true,
    applications: true,
    groups: true,
    commands: true,
    events: true,
    ...options.routes,
  };

  // Error handling middleware
  app.onError((error, c) => {
    if (options.onError) {
      return options.onError(error, c);
    }

    console.error('[OpenMDM] Error:', error);

    if (error instanceof HTTPException) {
      return c.json({ error: error.message }, error.status);
    }

    const mdmError = error as MDMError;
    if (mdmError.code && mdmError.statusCode) {
      return c.json(
        {
          error: mdmError.message,
          code: mdmError.code,
          details: mdmError.details,
        },
        mdmError.statusCode as any
      );
    }

    return c.json({ error: 'Internal server error' }, 500);
  });

  // Device authentication middleware
  const deviceAuth: MiddlewareHandler = async (c, next) => {
    const token = c.req.header('Authorization')?.replace('Bearer ', '');
    const deviceId = c.req.header('X-Device-Id');

    if (!token && !deviceId) {
      throw new HTTPException(401, { message: 'Device authentication required' });
    }

    if (token) {
      const result = await mdm.verifyDeviceToken(token);
      if (!result) {
        throw new HTTPException(401, { message: 'Invalid device token' });
      }
      c.set('deviceId', result.deviceId);
    } else if (deviceId) {
      c.set('deviceId', deviceId);
    }

    await next();
  };

  // Admin authentication middleware
  const adminAuth: MiddlewareHandler = async (c, next) => {
    if (!mdm.config.auth) {
      await next();
      return;
    }

    const user = await mdm.config.auth.getUser(c);
    if (!user) {
      throw new HTTPException(401, { message: 'Authentication required' });
    }

    if (mdm.config.auth.isAdmin) {
      const isAdmin = await mdm.config.auth.isAdmin(user);
      if (!isAdmin) {
        throw new HTTPException(403, { message: 'Admin access required' });
      }
    }

    c.set('user', user);
    await next();
  };

  // ============================================
  // Enrollment Routes (Device-facing)
  // ============================================

  if (routes.enrollment) {
    const enrollment = new Hono<MDMEnv>();

    // Enroll device
    enrollment.post('/enroll', async (c) => {
      const body = await c.req.json<EnrollmentRequest>();

      // Validate required fields
      if (!body.model || !body.manufacturer || !body.osVersion) {
        throw new HTTPException(400, {
          message: 'Missing required fields: model, manufacturer, osVersion',
        });
      }

      if (!body.macAddress && !body.serialNumber && !body.imei && !body.androidId) {
        throw new HTTPException(400, {
          message: 'At least one device identifier required',
        });
      }

      const result = await mdm.enroll(body);

      // Add server URL from request if not configured
      if (!result.serverUrl) {
        const url = new URL(c.req.url);
        result.serverUrl = `${url.protocol}//${url.host}`;
      }

      return c.json(result, 201);
    });

    // Device heartbeat
    enrollment.post('/heartbeat', deviceAuth, async (c) => {
      const deviceId = c.get('deviceId') as string;
      const body = await c.req.json<Omit<Heartbeat, 'deviceId'>>();

      await mdm.processHeartbeat(deviceId, {
        ...body,
        deviceId,
        timestamp: new Date(body.timestamp || Date.now()),
      });

      // Return pending commands for the device
      const pendingCommands = await mdm.commands.getPending(deviceId);

      // Get current policy if device has one
      const device = await mdm.devices.get(deviceId);
      let policyUpdate = null;
      if (device?.policyId) {
        policyUpdate = await mdm.policies.get(device.policyId);
      }

      return c.json({
        success: true,
        pendingCommands: pendingCommands,
        policyUpdate: policyUpdate,
      });
    });

    // Get device config/policy
    enrollment.get('/config', deviceAuth, async (c) => {
      const deviceId = c.get('deviceId') as string;
      const device = await mdm.devices.get(deviceId);

      if (!device) {
        throw new HTTPException(404, { message: 'Device not found' });
      }

      let policy = null;
      if (device.policyId) {
        policy = await mdm.policies.get(device.policyId);
      } else {
        policy = await mdm.policies.getDefault();
      }

      return c.json({
        device: {
          id: device.id,
          enrollmentId: device.enrollmentId,
          status: device.status,
        },
        policy,
      });
    });

    // Register push token
    enrollment.post('/push-token', deviceAuth, async (c) => {
      const deviceId = c.get('deviceId') as string;
      const body = await c.req.json<{ provider: string; token: string }>();

      await mdm.db.upsertPushToken({
        deviceId,
        provider: body.provider as any,
        token: body.token,
      });

      return c.json({ status: 'ok' });
    });

    // Acknowledge command
    enrollment.post('/commands/:id/ack', deviceAuth, async (c) => {
      const commandId = c.req.param('id');
      const command = await mdm.commands.acknowledge(commandId);
      return c.json(command);
    });

    // Complete command
    enrollment.post('/commands/:id/complete', deviceAuth, async (c) => {
      const commandId = c.req.param('id');
      const body = await c.req.json<{ success: boolean; message?: string; data?: unknown }>();
      const command = await mdm.commands.complete(commandId, body);
      return c.json(command);
    });

    // Fail command
    enrollment.post('/commands/:id/fail', deviceAuth, async (c) => {
      const commandId = c.req.param('id');
      const body = await c.req.json<{ error: string }>();
      const command = await mdm.commands.fail(commandId, body.error);
      return c.json(command);
    });

    app.route('/agent', enrollment);
  }

  // ============================================
  // Device Routes (Admin-facing)
  // ============================================

  if (routes.devices) {
    const devices = new Hono<MDMEnv>();

    if (options.enableAuth) {
      devices.use('/*', adminAuth);
    }

    // List devices
    devices.get('/', async (c) => {
      const filter: DeviceFilter = {
        status: c.req.query('status') as any,
        policyId: c.req.query('policyId'),
        groupId: c.req.query('groupId'),
        search: c.req.query('search'),
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      };

      const result = await mdm.devices.list(filter);
      return c.json(result);
    });

    // Get device
    devices.get('/:id', async (c) => {
      const device = await mdm.devices.get(c.req.param('id'));
      if (!device) {
        throw new HTTPException(404, { message: 'Device not found' });
      }
      return c.json(device);
    });

    // Update device
    devices.patch('/:id', async (c) => {
      const body = await c.req.json();
      const device = await mdm.devices.update(c.req.param('id'), body);
      return c.json(device);
    });

    // Delete device
    devices.delete('/:id', async (c) => {
      await mdm.devices.delete(c.req.param('id'));
      return c.json({ status: 'ok' });
    });

    // Assign policy to device
    devices.post('/:id/policy', async (c) => {
      const { policyId } = await c.req.json<{ policyId: string | null }>();
      const device = await mdm.devices.assignPolicy(c.req.param('id'), policyId);
      return c.json(device);
    });

    // Get device groups
    devices.get('/:id/groups', async (c) => {
      const groups = await mdm.devices.getGroups(c.req.param('id'));
      return c.json({ groups });
    });

    // Add device to group
    devices.post('/:id/groups', async (c) => {
      const { groupId } = await c.req.json<{ groupId: string }>();
      await mdm.devices.addToGroup(c.req.param('id'), groupId);
      return c.json({ status: 'ok' });
    });

    // Remove device from group
    devices.delete('/:id/groups/:groupId', async (c) => {
      await mdm.devices.removeFromGroup(c.req.param('id'), c.req.param('groupId'));
      return c.json({ status: 'ok' });
    });

    // Send command to device
    devices.post('/:id/commands', async (c) => {
      const body = await c.req.json<Omit<SendCommandInput, 'deviceId'>>();
      const command = await mdm.devices.sendCommand(c.req.param('id'), body);
      return c.json(command, 201);
    });

    // Convenience: Sync device
    devices.post('/:id/sync', async (c) => {
      const command = await mdm.devices.sync(c.req.param('id'));
      return c.json(command, 201);
    });

    // Convenience: Reboot device
    devices.post('/:id/reboot', async (c) => {
      const command = await mdm.devices.reboot(c.req.param('id'));
      return c.json(command, 201);
    });

    // Convenience: Lock device
    devices.post('/:id/lock', async (c) => {
      const body = await c.req.json<{ message?: string }>().catch(() => ({ message: undefined }));
      const command = await mdm.devices.lock(c.req.param('id'), body.message);
      return c.json(command, 201);
    });

    // Convenience: Wipe device
    devices.post('/:id/wipe', async (c) => {
      const body = await c.req.json<{ preserveData?: boolean }>().catch(() => ({ preserveData: undefined }));
      const command = await mdm.devices.wipe(c.req.param('id'), body.preserveData);
      return c.json(command, 201);
    });

    app.route('/devices', devices);
  }

  // ============================================
  // Policy Routes
  // ============================================

  if (routes.policies) {
    const policies = new Hono<MDMEnv>();

    if (options.enableAuth) {
      policies.use('/*', adminAuth);
    }

    // List policies
    policies.get('/', async (c) => {
      const result = await mdm.policies.list();
      return c.json({ policies: result });
    });

    // Get default policy
    policies.get('/default', async (c) => {
      const policy = await mdm.policies.getDefault();
      if (!policy) {
        throw new HTTPException(404, { message: 'No default policy set' });
      }
      return c.json(policy);
    });

    // Get policy
    policies.get('/:id', async (c) => {
      const policy = await mdm.policies.get(c.req.param('id'));
      if (!policy) {
        throw new HTTPException(404, { message: 'Policy not found' });
      }
      return c.json(policy);
    });

    // Create policy
    policies.post('/', async (c) => {
      const body = await c.req.json<CreatePolicyInput>();
      const policy = await mdm.policies.create(body);
      return c.json(policy, 201);
    });

    // Update policy
    policies.patch('/:id', async (c) => {
      const body = await c.req.json<UpdatePolicyInput>();
      const policy = await mdm.policies.update(c.req.param('id'), body);
      return c.json(policy);
    });

    // Delete policy
    policies.delete('/:id', async (c) => {
      await mdm.policies.delete(c.req.param('id'));
      return c.json({ status: 'ok' });
    });

    // Set default policy
    policies.post('/:id/default', async (c) => {
      const policy = await mdm.policies.setDefault(c.req.param('id'));
      return c.json(policy);
    });

    // Get devices with this policy
    policies.get('/:id/devices', async (c) => {
      const devices = await mdm.policies.getDevices(c.req.param('id'));
      return c.json({ devices });
    });

    app.route('/policies', policies);
  }

  // ============================================
  // Application Routes
  // ============================================

  if (routes.applications) {
    const applications = new Hono<MDMEnv>();

    if (options.enableAuth) {
      applications.use('/*', adminAuth);
    }

    // List applications
    applications.get('/', async (c) => {
      const activeOnly = c.req.query('active') === 'true';
      const result = await mdm.apps.list(activeOnly);
      return c.json({ applications: result });
    });

    // Get application by ID
    applications.get('/:id', async (c) => {
      const app = await mdm.apps.get(c.req.param('id'));
      if (!app) {
        throw new HTTPException(404, { message: 'Application not found' });
      }
      return c.json(app);
    });

    // Get application by package name
    applications.get('/package/:packageName', async (c) => {
      const version = c.req.query('version');
      const app = await mdm.apps.getByPackage(c.req.param('packageName'), version);
      if (!app) {
        throw new HTTPException(404, { message: 'Application not found' });
      }
      return c.json(app);
    });

    // Register application
    applications.post('/', async (c) => {
      const body = await c.req.json<CreateApplicationInput>();
      const app = await mdm.apps.register(body);
      return c.json(app, 201);
    });

    // Update application
    applications.patch('/:id', async (c) => {
      const body = await c.req.json<UpdateApplicationInput>();
      const app = await mdm.apps.update(c.req.param('id'), body);
      return c.json(app);
    });

    // Delete application
    applications.delete('/:id', async (c) => {
      await mdm.apps.delete(c.req.param('id'));
      return c.json({ status: 'ok' });
    });

    // Activate application
    applications.post('/:id/activate', async (c) => {
      const app = await mdm.apps.activate(c.req.param('id'));
      return c.json(app);
    });

    // Deactivate application
    applications.post('/:id/deactivate', async (c) => {
      const app = await mdm.apps.deactivate(c.req.param('id'));
      return c.json(app);
    });

    // Deploy application
    applications.post('/:packageName/deploy', async (c) => {
      const body = await c.req.json<{
        devices?: string[];
        policies?: string[];
        groups?: string[];
      }>();
      await mdm.apps.deploy(c.req.param('packageName'), body);
      return c.json({ status: 'ok', message: 'Deployment initiated' });
    });

    // Install app on device
    applications.post('/:packageName/install/:deviceId', async (c) => {
      const version = c.req.query('version');
      const command = await mdm.apps.installOnDevice(
        c.req.param('packageName'),
        c.req.param('deviceId'),
        version
      );
      return c.json(command, 201);
    });

    // Uninstall app from device
    applications.post('/:packageName/uninstall/:deviceId', async (c) => {
      const command = await mdm.apps.uninstallFromDevice(
        c.req.param('packageName'),
        c.req.param('deviceId')
      );
      return c.json(command, 201);
    });

    app.route('/applications', applications);
  }

  // ============================================
  // Group Routes
  // ============================================

  if (routes.groups) {
    const groups = new Hono<MDMEnv>();

    if (options.enableAuth) {
      groups.use('/*', adminAuth);
    }

    // List groups
    groups.get('/', async (c) => {
      const result = await mdm.groups.list();
      return c.json({ groups: result });
    });

    // Get group
    groups.get('/:id', async (c) => {
      const group = await mdm.groups.get(c.req.param('id'));
      if (!group) {
        throw new HTTPException(404, { message: 'Group not found' });
      }
      return c.json(group);
    });

    // Create group
    groups.post('/', async (c) => {
      const body = await c.req.json<CreateGroupInput>();
      const group = await mdm.groups.create(body);
      return c.json(group, 201);
    });

    // Update group
    groups.patch('/:id', async (c) => {
      const body = await c.req.json<UpdateGroupInput>();
      const group = await mdm.groups.update(c.req.param('id'), body);
      return c.json(group);
    });

    // Delete group
    groups.delete('/:id', async (c) => {
      await mdm.groups.delete(c.req.param('id'));
      return c.json({ status: 'ok' });
    });

    // Get devices in group
    groups.get('/:id/devices', async (c) => {
      const devices = await mdm.groups.getDevices(c.req.param('id'));
      return c.json({ devices });
    });

    // Add device to group
    groups.post('/:id/devices', async (c) => {
      const { deviceId } = await c.req.json<{ deviceId: string }>();
      await mdm.groups.addDevice(c.req.param('id'), deviceId);
      return c.json({ status: 'ok' });
    });

    // Remove device from group
    groups.delete('/:id/devices/:deviceId', async (c) => {
      await mdm.groups.removeDevice(c.req.param('id'), c.req.param('deviceId'));
      return c.json({ status: 'ok' });
    });

    // Get child groups
    groups.get('/:id/children', async (c) => {
      const children = await mdm.groups.getChildren(c.req.param('id'));
      return c.json({ groups: children });
    });

    app.route('/groups', groups);
  }

  // ============================================
  // Command Routes
  // ============================================

  if (routes.commands) {
    const commands = new Hono<MDMEnv>();

    if (options.enableAuth) {
      commands.use('/*', adminAuth);
    }

    // List commands
    commands.get('/', async (c) => {
      const filter: CommandFilter = {
        deviceId: c.req.query('deviceId'),
        status: c.req.query('status') as any,
        type: c.req.query('type') as any,
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      };

      const result = await mdm.commands.list(filter);
      return c.json({ commands: result });
    });

    // Get command
    commands.get('/:id', async (c) => {
      const command = await mdm.commands.get(c.req.param('id'));
      if (!command) {
        throw new HTTPException(404, { message: 'Command not found' });
      }
      return c.json(command);
    });

    // Send command
    commands.post('/', async (c) => {
      const body = await c.req.json<SendCommandInput>();
      const command = await mdm.commands.send(body);
      return c.json(command, 201);
    });

    // Cancel command
    commands.post('/:id/cancel', async (c) => {
      const command = await mdm.commands.cancel(c.req.param('id'));
      return c.json(command);
    });

    app.route('/commands', commands);
  }

  // ============================================
  // Event Routes
  // ============================================

  if (routes.events) {
    const events = new Hono<MDMEnv>();

    if (options.enableAuth) {
      events.use('/*', adminAuth);
    }

    // List events
    events.get('/', async (c) => {
      const filter = {
        deviceId: c.req.query('deviceId'),
        type: c.req.query('type') as any,
        limit: c.req.query('limit') ? parseInt(c.req.query('limit')!) : undefined,
        offset: c.req.query('offset') ? parseInt(c.req.query('offset')!) : undefined,
      };

      const result = await mdm.db.listEvents(filter);
      return c.json({ events: result });
    });

    app.route('/events', events);
  }

  // ============================================
  // Health Check
  // ============================================

  app.get('/health', (c) => {
    return c.json({
      status: 'ok',
      version: '0.1.0',
      timestamp: new Date().toISOString(),
    });
  });

  return app;
}
