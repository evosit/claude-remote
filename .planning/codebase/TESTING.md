# Testing Strategy

## Current State

**No automated tests exist.** This project relies entirely on manual integration testing through actual Claude Code sessions and Discord interactions.

## Testing Challenges

1. **Discord API Integration**
   - Requires a live Discord bot and test server
   - Network dependencies complicate unit tests
   - Rate limits constrain test runs

2. **PTY Processes**
   - Spawns `claude.exe` (Windows-only)
   - Requires full Claude Code installation
   - Process lifecycle hard to simulate

3. **File Watching**
   - `chokidar` depends on real file system events
   - Hard to deterministically test event timing

4. **Handler Pipeline**
   - Good candidate for unit tests but not yet implemented
   - Message rendering depends on complex Discord.js objects

## Manual Testing Approach

### Setup Test Environment

1. Create test Discord server with category "Claude RC"
2. Configure bot with required intents and permissions
3. Run `claude-remote setup` with test credentials

### Smoke Tests

- [ ] Start Claude: `claude-remote -p "hello"` → Channel created, messages appear
- [ ] Tool approvals: Allow/Deny buttons work, Claude proceeds accordingly
- [ ] File edits: `Edit` tool shows diffs in Discord
- [ ] Long output: Large responses go to threads
- [ ] Tasks: Task tools create pinned progress board
- [ ] Thinking indicator: Toggle shows/hides correctly
- [ ] Plan mode: Enters/exits plan mode shows status embed

### Interaction Tests

- [ ] Discord → Claude: Type in channel → Claude receives message
- [ ] Image attachments: Upload image → Claude can see it
- [ ] Select menus: Options render and selection sends to Claude
- [ ] Modals: Submit modal → text appears in Claude
- [ ] `/remote off`: Disables sync, messages not forwarded
- [ ] `/remote on`: Re-enables sync
- [ ] `/stop`: Sends Ctrl+C to Claude
- [ ] `/clear`: Clears context, new channel created

### Edge Cases

- [ ] JSONL truncation/recovery (edit transcript manually)
- [ ] Daemon crash → restart behavior
- [ ] Network drop → reconnection
- [ ] Claude exit → parent cleanup
- [ ] Multiple concurrent sessions (should not interfere)

## Recommendations for Future Test Implementation

### Unit Tests (Jest / Vitest)

**Priority: High**

Targets:

1. **`jsonl-parser.ts`** – Pure function, deterministic
   - Parse each message type (user, assistant, tool-result, etc.)
   - Handle malformed JSONL
   - Extract content blocks, tool inputs, images

2. **`utils.ts`** – Pure helpers
   - `mimeToExt()`, `truncate()`, `capSet()`
   - Path resolution

3. **`format-tool.ts`** – Formatting logic
   - Tool name display
   - Input preview rendering

4. **Handler logic** (individual files)
   - Mock `SessionContext` and `provider`
   - Verify `handle()` returns correct `consumed`/`pass` decisions
   - Test rendering functions in isolation

**Mocking strategy**:
- Use in-memory file system (`memfs`) for file watching tests
- Mock `discord.js` objects (Message, TextChannel, etc.)
- Use jest.f timers for debounce/batch testing

### Integration Tests

**Priority: Medium**

- Spin up test Discord server (requires dedicated bot token)
- Use `node-pty` to spawn mock Claude (simple script writing JSONL)
- Test full daemon pipeline end-to-end

**Challenges**: Flaky networks, Discord rate limits. Use retry logic.

### E2E Tests (Playwright)

**Priority: Low**

- Automate Claude Code UI to generate JSONL
- Mock Discord server or use real test server
- Validate end-to-end message flow

**Cost**: High maintenance burden. Manual testing likely sufficient for now.

## Coverage Goals

- **Critical path** (handler pipeline) → 80%+ coverage
- **Utilities** → 90%+ coverage
- **Discord provider** → moderate (mostly integrates with Discord.js)
- **PTY/pipe code** → skip (system-level)

## Test Infrastructure (Not Yet Implemented)

If implementing tests:

```
package.json additions:
  "test": "jest"
  "test:watch": "jest --watch"
  "test:coverage": "jest --coverage"

jest.config.js:
  preset: "ts-jest"
  testEnvironment: "node"
  moduleNameMapper: { "^(\\.{1,2}/.*)\\.js$": "$1" }

__tests__/ directory:
  jsonl-parser.test.ts
  utils.test.ts
  handlers/
    thinking.test.ts
    tool-use.test.ts
    ...
```

## Debugging Tools

Current shortcuts:

- `rc.ts:187` – Comment suggests daemon output logging to file (unimplemented)
- `daemon.ts` console logs – Live observation of pipeline
- Claude Code statusline – Shows sync status
- Discord channel – Visual confirmation of all outputs

## Integration Test Checklist

When making changes to handlers or core pipeline:

1. ✅ Start `claude-remote` with test config
2. ✅ Run a simple task: "list files"
3. ✅ Verify output appears in Discord channel
4. ✅ Test a tool call that requires approval → Allow/Deny
5. ✅ Check that long output goes to thread
6. ✅ Verify task board updates (if using tasks)
7. ✅ Stop Claude → daemon exits cleanly

## Known Test Gaps

- **Slash command registration** – Not tested, assumes Discord API success
- **Alias installation** – Modifies shell profiles, no cleanup tests
- **Update checking** – Network call, no success/failure handling tested
- **Provider caching** – LRU eviction not covered
- **Thread management** – Archiving, reuse logic untested

## Regression Testing

Since no automated tests exist, regression testing is **manual**:
- Use the integration test checklist above for any handler/pipeline changes
- Test both "happy path" and failure modes (disconnect Discord bot mid-session)

## Tools Not Used

- **ESLint**: Not configured (rely on TypeScript errors)
- **Prettier**: Not configured
- **Husky**: No pre-commit hooks
- **CI/CD**: GitHub Actions only for publish, no test workflow
