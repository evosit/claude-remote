# Testing Strategy

## Current State: No Automated Tests

This project does **not** have any automated test suite. All testing is manual integration testing against a real Discord bot and Claude Code instance.

**Test coverage**: Unknown (likely <5% for trivial utilities only).

## Why No Tests?

1. **Discord integration** – Requires live bot, test server, network.
2. **PTY processes** – Hard to spawn and control `claude.exe` in unit tests.
3. **File watching** – `chokidar` depends on real FS events, timing-sensitive.
4. **Historical**: Small team, manual testing sufficient for velocity.
5. **Priority**: Features > Stability (regrettable but factual).

## Testing Done Manually

### Setup Test Environment

1. Create test Discord server with category "Claude RC"
2. Create bot application, enable intents (Message Content, Guilds)
3. Invite bot to server with permissions: Send Messages, Manage Channels, Read History, Manage Threads
4. Configure `~/.claude/claude-remote/config.json` with token, guild ID, category ID
5. Run `claude-remote setup` to install hooks/skill

### Smoke Test Checklist

When making changes to core (pipeline, handlers, provider):

1. **Start session**:
   - `claude-remote -p "hello"` → Channel created, Claude responds, messages appear in Discord.
2. **Tool approval**:
   - Ask Claude to read a file → Allow/Deny buttons appear → Clicking Allow proceeds, Deny aborts.
3. **File edits**:
   - Ask Claude to edit a file → Diff displayed in Discord with syntax highlighting.
4. **Long output**:
   - Ask Claude to list many files → Response goes to thread (not inline).
5. **Task boards**:
   - Run `/tasks` or trigger task tool → Pinned progress board appears and updates.
6. **Thinking indicator**:
   - Claude enters thinking → Show/hide indicator toggles (verify visually).
7. **Plan mode**:
   - Enter plan mode → Status embed appears in channel.
8. **Discord → Claude**:
   - Type message in Discord → Claude receives and responds.
9. **Image attachments**:
   - Upload image in Discord → Claude can analyze it.
10. **Select menus**:
    - Present options → Selection sends to Claude correctly.
11. **Modals**:
    - Modal submission → Text arrives in Claude.
12. **Remote control**:
    - `/remote off` → Stops syncing.
    - `/remote on` → Resumes syncing.
    - `/status` → Shows session info.
    - `/stop` → Sends interrupt, Claude stops.
    - `/clear` → New channel created, context cleared.
13. **Exit and resume**:
    - Ctrl+C Claude → daemon exits cleanly.
    - Restart `claude-remote --resume` → Reconnects to same or new session.

### Edge Cases

- **JSONL corruption**: Truncate file mid-line → daemon should skip malformed and continue.
- **Rapid toggling**: `/remote off` / `/remote on` repeatedly → daemon restarts cleanly, no leaks.
- **Discord disconnect**: Kill Discord bot → daemon should reconnect or fail gracefully (manual restart currently).
- **Claude crash**: Force kill `claude.exe` → parent terminates daemon and exits.
- **Large transcripts**: Manually create large JSONL (10k lines) → startup replay time acceptable (<2s).

## Target Test Types (Future)

### Unit Tests (Priority: High)

Targets: Pure functions and isolated classes.

**Candidates**:
- `jsonl-parser.ts`: All parse functions, `walkCurrentBranch` (with mock fs)
- `utils.ts`: `truncate`, `mimeToExt`, `capSet`, `isLocalCommand`, `extractToolResult*`
- `format-tool.ts`: Formatting logic
- Individual handlers: Test `handle(pm, ctx)` with mocked `ctx.provider`, verify:
  - Return value (`consumed`/`pass`)
  - `provider` calls (sent messages, thread created, etc.)
  - Mutations to `ctx` (e.g., `taskBoardHandle` updated)

**Mocking strategy**:
- Use `jest` or `vitest`.
- Mock `discord.js` objects (Message, TextChannel, etc.) with simple objects.
- Mock `SessionContext` with stubbed provider methods.
- Use `jest.useFakeTimers()` for debounce tests.

**Example test**: `jsonl-parser.test.ts`

```typescript
test("parse user message with text", () => {
  const jsonl = '{"type":"user","message":{"content":[{"type":"text","text":"hello"}]}}';
  const result = parseJSONLString(jsonl);
  expect(result).toHaveLength(1);
  expect(result[0].type).toBe("user");
  expect(result[0].text).toBe("hello");
});
```

### Integration Tests (Priority: Medium)

Test daemon pipeline with mock Discord provider.

- Create `DiscordProvider` mock that records sent messages.
- Feed sample `ProcessedMessage[]` to `handlerPipeline.process()`.
- Assert provider received expected calls in order.
- Test batching and rate limiting logic.

**Tool**: Node test runner (no browser).

### End-to-End Tests (Priority: Low)

- Use Playwright to control Claude Code UI? Too complex.
- Better: Dedicated test bot server with CI that runs smoke tests manually triggered.

## Recommended Test Framework

**Jest** (most common, good mocking) or **Vitest** (faster, modern).

Setup:

```bash
npm install --save-dev jest @types/jest ts-jest
npx ts-jest config:init
```

`jest.config.js`:

```js
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1' // strip .js for TS imports
  },
  testMatch: ['**/__tests__/**/*.test.ts'],
  collectCoverageFrom: ['src/**/*.ts'],
};
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  }
}
```

## Coverage Goals

- **Critical path** (pipeline, handlers, parser): 80%+
- **Utilities**: 90%+
- **Provider**: 60%+ (integration-heavy)
- **PTY/pipe code**: 30% (system-level, hard to unit test; skip)

## Known Test Gaps

| Area | Test Status | Notes |
|------|-------------|-------|
| `jsonl-parser` | ❌ None | Pure, easy to test |
| `utils.*` | ❌ None | Pure, easy |
| `format-tool` | ❌ None | Pure |
| Handlers | ❌ None | Mockable with `SessionContext` |
| `pipeline` | ❌ None | Integration test for order |
| `activity.ts` | ❌ None | Timer-based, testable with fake timers |
| `DiscordProvider` | ❌ None | Hard – needs mock Discord.js |
| `rc.ts` | ❌ None | PTY + pipe – integration test needed |
| `daemon.ts` | ❌ None | Full integration – many mocks |
| `cli.ts` | ❌ None | Setup wizard – user interaction |

## Test Harness Ideas

### Mock DiscordProvider

For handler tests, provide a lightweight mock:

```typescript
class MockProvider implements OutputProvider {
  sent: OutgoingMessage[] = [];
  async send(msg) { this.sent.push(msg); return { id: "msg-" + this.sent.length }; }
  async edit() {}
  async delete() {}
  async pin() {}
  async destroy() {}
}
```

Then:

```typescript
const mockProvider = new MockProvider();
const ctx: SessionContext = {
  provider: mockProvider,
  channel: { /* minimally mocked */ },
  isEnabled: true,
  isBusy: false,
  taskBoardHandle: null,
  passiveGroup: null,
  activeThreads: new Map(),
};

const handler = new ToolUseHandler();
await handler.handle(processedMessage, ctx);

expect(mockProvider.sent.some(m => m.embed?.title?.includes("Tool call")));
```

### jsonl-parser fixtures

Store sample Claude JSONL lines in `__tests__/fixtures/`:

- `user-text.jsonl`
- `assistant-tool-use.jsonl`
- `tool-result.jsonl`
- `file-edit.jsonl`
- `task-start-end.jsonl`
- `thinking.jsonl`
- malformed `invalid.jsonl`

## Regression Testing Process

Since no automated tests, manual regression checklist when merging:

1. Build: `npm run build` succeeds
2. Install: `npm install -g` into clean global node_modules (or `npm link`)
3. Run smoke test (see above) with real Discord bot
4. Test `/remote on/off/status`
5. Test tool approvals
6. Test long outputs threaded
7. Test task boards
8. Test `/stop` and `/clear`

**Requirement**: All 8 checks pass before merge.

**Risk**: Manual testing is slow and may miss subtle bugs.

## Integration Test Environment

Recommended: Dedicated Discord server for testing.
- Bot token stored in `DISCORD_BOT_TOKEN` (CI secret)
- Guild and category IDs known
- Pipe registry and transcripts in temp dir (`TMPDIR`)

CI could non-blockingly run unit tests; integration tests on demand only.

## Performance Testing

Not done. Potential metrics:
- Messages per second throughput
- Latency from Claude output to Discord message
- Memory growth over 24h
- Rate limit handling under burst (100 messages in 1s)

No load testing tooling.

## Observability in Tests

- Add `DEBUG` env var support? Not needed.
- Mock console logs to assert error conditions.

## Known Flaky Areas

- **chokidar timing** – Debounce 600ms may cause test flakiness if not mocked.
- **Discord rate limits** – Integration tests could hit limits if not using test bot with higher quotas.
- **PTY spawning** – Requires Windows environment; CI likely Linux (GitHub Actions), so win32 tests problematic.

Recommendation: Skip PTY/pipe tests in CI; run on Windows runner only or exclude with `@skip-on-windows`.

## Test Documentation

- `TESTING.md` (this file) – strategy and gaps.
- Individual test files should include:
  - JSDoc describing what is under test
  - Clear assertions
  - Arrange/Act/Assert sections

## Test Data Management

- Do not hit real Discord API in unit tests (mock provider).
- Use fixture JSONL files stored in repo.
- Clean up temp files/dirs in `afterEach()`.

## Migration to Tested Codebase

When adding first test suite:

1. Add `jest` config and scripts to `package.json`.
2. Create `__tests__/` directory with sample tests.
3. Refactor code to be more testable:
   - Export pure functions (some are internal currently).
   - Reduce module-level state.
   - Inject dependencies (e.g., file system wrapper).
4. Write tests for highest-value modules: `jsonl-parser`, `utils`, first handler (`thinking`).
5. Increase coverage incrementally; track in README badge (optional).

## QA Checklist (Manual)

For each release candidate:
- [ ] Build passes (`npm run build`)
- [ ] Install into fresh environment (no existing config)
- [ ] Run `claude-remote setup` end-to-end
- [ ] Start session, verify channel created
- [ ] Send message from Discord, verify Claude responds
- [ ] Test all slash commands (`/status`, `/stop`, `/clear`, `/compact`, `/queue`)
- [ ] Test tool approvals (Allow/Deny)
- [ ] Test file edit display
- [ ] Test long output threading
- [ ] Test task board creation/updates
- [ ] Test `/remote off` / `/remote on`
- [ ] Test `/stop` then resume
- [ ] Test `/clear` creates new channel
- [ ] Test image attachments
- [ ] Test select menus and modals
- [ ] Uninstall cleanly (`claude-remote uninstall`)
- [ ] Reinstall to verify idempotency

## Bug Verification Process

When a bug is reported:

1. Reproduce manually with steps.
2. If root cause found, add regression test (if feasible) **before** fixing.
3. Fix the bug.
4. Verify test passes and original manual steps succeed.
5. If adding test not feasible (too integration-heavy), update manual QA checklist with a specific step.

## Test Coverage Reporting

When tests added:

```bash
npm run test:coverage
# opens HTML report in coverage/
```

Target: 70% overall, 80% for critical modules.

## Future: Property-Based Testing?

Consider `fast-check` for generating random inputs to `jsonl-parser` to find edge cases (malformed JSON, missing fields, unusual Unicode).

## Future: Fuzzing

Fuzz the parser with random bytes to ensure it never crashes on malformed input (should skip line and continue).

## Current Test Gaps Impact

| Gap | Risk | Mitigation |
|-----|------|------------|
| No parser tests | Parser regressions on edge-case JSONL | Manual testing with varied Claude outputs |
| No handler tests | Handler logic regressions, side effects | Careful code review, manual integration |
| No provider tests | Discord integration bugs | Live testing against test bot |
| No PTY tests | Process lifecycle bugs | Manual tests for start/stop/resume |
| No rate limit tests | Floods Discord API, 429s | Monitor Discord API responses, manual burst tests |

---

**Recommendation**: Start with `jsonl-parser.test.ts` (high value, low friction). Then `utils.test.ts`. Then one handler (`thinking.ts`). Build momentum.
