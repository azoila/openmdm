# Apps

This directory previously contained the Android agent app. It has been moved to a separate repository for easier customization and forking.

## Android Agent

The official OpenMDM Android agent is now at:

**Repository**: [openmdm/openmdm-android](https://github.com/openmdm/openmdm-android)

### Why a Separate Repository?

1. **Easier to Fork**: Android developers can clone just the Android code
2. **Independent Versioning**: Agent can release independently from the SDK
3. **Standard Android Project**: No monorepo tooling complexity
4. **Customization-Friendly**: Fork, brand, and maintain your own version

### Quick Start

```bash
# Clone the Android agent
git clone https://github.com/openmdm/openmdm-android

# Build the agent
cd openmdm-android
./gradlew :agent:assembleRelease

# Or use the library in your own app
implementation("com.github.openmdm:openmdm-android:library:0.1.0")
```

See the [openmdm-android README](https://github.com/openmdm/openmdm-android) for full documentation.
