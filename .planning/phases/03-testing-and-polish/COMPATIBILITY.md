# Linux Distribution Compatibility

This document outlines distribution-specific considerations for running `claude-remote` on Linux.

## Support Matrix

| Distribution | Status | Notes |
|--------------|--------|-------|
| Ubuntu 22.04+ | ✅ Fully supported | Primary target, glibc |
| Fedora (latest) | ✅ Fully supported | glibc, test regularly |
| Alpine Linux 3.19+ | ⚠️ Requires extra steps | musl libc, needs manual build |
| WSL2 (Ubuntu) | ⚠️ Known quirks | File watching may have delays |

---

## Alpine Linux

Alpine uses musl libc and BusyBox, which differs from glibc-based distributions. Prebuilt Node.js binaries may not work; you may need to compile native modules manually.

### Required Packages

```bash
apk add build-base python3 linux-headers
```

This installs:
- `build-base` — gcc, g++, make, libc-dev (compilation toolchain)
- `python3` — required by node-gyp
- `linux-headers` — kernel headers for native builds

### Building

```bash
npm ci
npm run build
```

### Notes

- `node-pty` is a native module that requires compilation. The toolchain above ensures it builds successfully.
- If the build fails, consider switching to a glibc-based distribution (Ubuntu, Fedora) for a smoother experience.
- Performance on musl may be slightly faster, but prebuilt binaries are not available, so every install requires compilation.

### Known Limitations

- Some npm packages may assume glibc. If you encounter runtime errors related to missing glibc symbols, Alpine may not be supported.
- In such cases, using Ubuntu or Fedora is recommended.

---

## WSL2

WSL2 provides a Linux-compatible kernel but runs on Windows. While most functionality works, be aware of:

- **File watching**: When editing files from Windows editors (via `/mnt/c/...`), inotify events may be delayed or missed. Test your workflow.
- **Socket cleanup**: WSL2 cleans up `/tmp` on shutdown, but stale sockets may persist if WSL crashes. Check manually if connection issues arise.
- **Terminal emulation**: PTY rendering is generally fine, but some advanced features may differ.

---

## General Requirements

All distributions require:

- Node.js 18+ (use nvm or distro package)
- Build tools for native modules (see above for Alpine)
- Discord bot token with appropriate intents
- Network connectivity to Discord API

---

**End of COMPATIBILITY.md**
