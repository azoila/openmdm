# Contributing to OpenMDM

First off, thank you for considering contributing to OpenMDM! It's people like you that make OpenMDM such a great tool.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Setup](#development-setup)
- [Project Structure](#project-structure)
- [Making Changes](#making-changes)
- [Submitting a Pull Request](#submitting-a-pull-request)
- [Coding Guidelines](#coding-guidelines)
- [Commit Messages](#commit-messages)
- [Reporting Bugs](#reporting-bugs)
- [Suggesting Features](#suggesting-features)

## Code of Conduct

This project and everyone participating in it is governed by our [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code. Please report unacceptable behavior to [conduct@openmdm.dev](mailto:conduct@openmdm.dev).

## Getting Started

### Prerequisites

- Node.js 20 or later
- pnpm 9.0 or later
- Git

### Development Setup

1. **Fork the repository**

   Click the "Fork" button on the [OpenMDM repository](https://github.com/azoila/openmdm).

2. **Clone your fork**

   ```bash
   git clone git@github.com:YOUR_USERNAME/openmdm.git
   cd openmdm
   ```

3. **Add the upstream remote**

   ```bash
   git remote add upstream git@github.com:azoila/openmdm.git
   ```

4. **Install dependencies**

   ```bash
   pnpm install
   ```

5. **Build all packages**

   ```bash
   pnpm build
   ```

6. **Run tests**

   ```bash
   pnpm test
   ```

## Project Structure

```
openmdm/
├── packages/
│   ├── core/                 # Core MDM SDK
│   ├── storage/
│   │   └── s3/               # S3 storage adapter
│   ├── adapters/
│   │   ├── drizzle/          # Drizzle ORM adapter
│   │   └── hono/             # Hono framework adapter
│   ├── push/
│   │   ├── fcm/              # FCM push adapter
│   │   └── mqtt/             # MQTT push adapter
│   ├── plugins/
│   │   ├── kiosk/            # Kiosk mode plugin
│   │   └── geofence/         # Geofencing plugin
│   ├── client/               # Device-side SDK
│   └── cli/                  # CLI tools
├── apps/
│   └── android-agent/        # Android Agent app (Kotlin)
├── examples/                 # Example applications
└── docs/                     # Documentation
```

## Making Changes

1. **Create a branch**

   ```bash
   git checkout -b feat/my-feature
   # or
   git checkout -b fix/my-bug-fix
   ```

2. **Make your changes**

   Write your code and make sure to:
   - Add tests for new functionality
   - Update documentation if needed
   - Follow the coding guidelines below

3. **Run checks locally**

   ```bash
   # Type check
   pnpm typecheck

   # Run tests
   pnpm test

   # Build all packages
   pnpm build
   ```

4. **Commit your changes**

   Follow the [commit message guidelines](#commit-messages) below.

## Submitting a Pull Request

1. **Push your branch**

   ```bash
   git push origin feat/my-feature
   ```

2. **Open a Pull Request**

   Go to the [OpenMDM repository](https://github.com/azoila/openmdm) and click "New Pull Request".

3. **Fill out the PR template**

   - Describe what your changes do
   - Reference any related issues
   - Include screenshots if applicable

4. **Wait for review**

   A maintainer will review your PR. Please be patient and responsive to feedback.

## Coding Guidelines

### TypeScript

- Use TypeScript strict mode
- Prefer `interface` over `type` for object shapes
- Use explicit return types for public functions
- Avoid `any` - use `unknown` if the type is truly unknown

### Code Style

- Use 2 spaces for indentation
- Use single quotes for strings
- No semicolons (we use Prettier defaults)
- Maximum line length of 100 characters

### Naming Conventions

- **Files**: `kebab-case.ts` (e.g., `push-adapter.ts`)
- **Classes**: `PascalCase` (e.g., `DeviceManager`)
- **Functions/Variables**: `camelCase` (e.g., `getDevice`)
- **Constants**: `SCREAMING_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)
- **Types/Interfaces**: `PascalCase` (e.g., `DeviceConfig`)

### Testing

- Write tests for all new functionality
- Use descriptive test names
- Follow the Arrange-Act-Assert pattern
- Mock external dependencies

```typescript
describe('DeviceManager', () => {
  describe('get', () => {
    it('should return device when found', async () => {
      // Arrange
      const mockDevice = { id: '123', status: 'enrolled' };
      mockDb.findDevice.mockResolvedValue(mockDevice);

      // Act
      const result = await deviceManager.get('123');

      // Assert
      expect(result).toEqual(mockDevice);
    });
  });
});
```

### Documentation

- Add JSDoc comments to public APIs
- Update README if adding new features
- Include code examples in documentation

```typescript
/**
 * Get a device by its ID.
 *
 * @param id - The device ID
 * @returns The device if found, null otherwise
 *
 * @example
 * ```typescript
 * const device = await mdm.devices.get('device-123');
 * if (device) {
 *   console.log(device.status);
 * }
 * ```
 */
async get(id: string): Promise<Device | null> {
  // ...
}
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/). Each commit message should have the format:

```
<type>(<scope>): <description>

[optional body]

[optional footer(s)]
```

### Types

- `feat`: A new feature
- `fix`: A bug fix
- `docs`: Documentation only changes
- `style`: Changes that don't affect code meaning (formatting, etc.)
- `refactor`: Code change that neither fixes a bug nor adds a feature
- `perf`: A code change that improves performance
- `test`: Adding missing tests or correcting existing tests
- `chore`: Changes to the build process or auxiliary tools

### Scopes

- `core`: Changes to @openmdm/core
- `storage`: Changes to storage adapters
- `push`: Changes to push adapters
- `plugins`: Changes to plugins
- `cli`: Changes to CLI tools
- `android`: Changes to Android agent
- `docs`: Documentation changes

### Examples

```
feat(core): add webhook delivery system

- Add WebhookManager with HMAC signing
- Support exponential backoff retry
- Integrate with event system

Closes #123
```

```
fix(push-fcm): handle token refresh correctly

The FCM adapter was not updating tokens when they expired.
This fix adds a token refresh handler that updates the database.

Fixes #456
```

## Reporting Bugs

Before creating a bug report, please check if the issue already exists. When creating a bug report, include:

- **Clear title** describing the issue
- **Steps to reproduce** the behavior
- **Expected behavior** vs. actual behavior
- **Environment details** (OS, Node.js version, etc.)
- **Code samples** if applicable
- **Error messages** and stack traces

Use the [Bug Report template](.github/ISSUE_TEMPLATE/bug_report.yml) when creating issues.

## Suggesting Features

We love feature suggestions! When suggesting a feature:

- **Describe the problem** you're trying to solve
- **Propose a solution** if you have one
- **Consider alternatives** you've thought about
- **Provide context** on how this would help you

Use the [Feature Request template](.github/ISSUE_TEMPLATE/feature_request.yml) when creating issues.

## Questions?

- Join our [Discord](https://discord.gg/openmdm) for real-time chat
- Open a [GitHub Discussion](https://github.com/azoila/openmdm/discussions) for questions
- Check the [documentation](https://openmdm.dev/docs) for guides

Thank you for contributing to OpenMDM!
