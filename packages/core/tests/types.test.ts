import { describe, it, expect } from 'vitest';
import {
  MDMError,
  DeviceNotFoundError,
  PolicyNotFoundError,
  ApplicationNotFoundError,
  EnrollmentError,
  AuthenticationError,
  AuthorizationError,
  ValidationError,
} from '../src/types';

describe('Error Types', () => {
  describe('MDMError', () => {
    it('should create error with code and status', () => {
      const error = new MDMError('Test error', 'TEST_ERROR', 500);

      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_ERROR');
      expect(error.statusCode).toBe(500);
      expect(error.name).toBe('MDMError');
    });

    it('should include details', () => {
      const error = new MDMError('Test error', 'TEST_ERROR', 400, { field: 'value' });

      expect(error.details).toEqual({ field: 'value' });
    });
  });

  describe('DeviceNotFoundError', () => {
    it('should have correct message and status', () => {
      const error = new DeviceNotFoundError('device-123');

      expect(error.message).toBe('Device not found: device-123');
      expect(error.code).toBe('DEVICE_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('PolicyNotFoundError', () => {
    it('should have correct message and status', () => {
      const error = new PolicyNotFoundError('policy-456');

      expect(error.message).toBe('Policy not found: policy-456');
      expect(error.code).toBe('POLICY_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('ApplicationNotFoundError', () => {
    it('should have correct message and status', () => {
      const error = new ApplicationNotFoundError('com.example.app');

      expect(error.message).toBe('Application not found: com.example.app');
      expect(error.code).toBe('APPLICATION_NOT_FOUND');
      expect(error.statusCode).toBe(404);
    });
  });

  describe('EnrollmentError', () => {
    it('should have correct code and status', () => {
      const error = new EnrollmentError('Invalid signature');

      expect(error.message).toBe('Invalid signature');
      expect(error.code).toBe('ENROLLMENT_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should include details', () => {
      const error = new EnrollmentError('Validation failed', { fields: ['signature'] });

      expect(error.details).toEqual({ fields: ['signature'] });
    });
  });

  describe('AuthenticationError', () => {
    it('should have default message', () => {
      const error = new AuthenticationError();

      expect(error.message).toBe('Authentication required');
      expect(error.code).toBe('AUTHENTICATION_ERROR');
      expect(error.statusCode).toBe(401);
    });

    it('should accept custom message', () => {
      const error = new AuthenticationError('Token expired');

      expect(error.message).toBe('Token expired');
    });
  });

  describe('AuthorizationError', () => {
    it('should have default message', () => {
      const error = new AuthorizationError();

      expect(error.message).toBe('Access denied');
      expect(error.code).toBe('AUTHORIZATION_ERROR');
      expect(error.statusCode).toBe(403);
    });

    it('should accept custom message', () => {
      const error = new AuthorizationError('Insufficient permissions');

      expect(error.message).toBe('Insufficient permissions');
    });
  });

  describe('ValidationError', () => {
    it('should have correct code and status', () => {
      const error = new ValidationError('Invalid input');

      expect(error.message).toBe('Invalid input');
      expect(error.code).toBe('VALIDATION_ERROR');
      expect(error.statusCode).toBe(400);
    });

    it('should include validation details', () => {
      const error = new ValidationError('Validation failed', {
        errors: [
          { field: 'name', message: 'Required' },
          { field: 'email', message: 'Invalid format' },
        ],
      });

      expect(error.details).toEqual({
        errors: [
          { field: 'name', message: 'Required' },
          { field: 'email', message: 'Invalid format' },
        ],
      });
    });
  });
});
