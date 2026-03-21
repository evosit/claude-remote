# Discord Setup Guide

This guide provides detailed, step-by-step instructions for creating and configuring a Discord bot for use with claude-remote.

## Table of Contents

1. [Create Discord Application](#create-discord-application)
2. [Configure Bot Settings](#configure-bot-settings)
3. [Set Up Bot Permissions](#set-up-bot-permissions)
4. [Invite Bot to Server](#invite-bot-to-server)
5. [Configure Channel Structure](#configure-channel-structure)
6. [Get Required IDs](#get-required-ids)
7. [Configure claude-remote](#configure-claude-remote)
8. [Troubleshooting](#troubleshooting)

---

## Create Discord Application

1. Open the [Discord Developer Portal](https://discord.com/developers/applications)
2. Sign in with your Discord account if prompted
3. Click the **"New Application"** button in the top right
4. Enter an **Application Name** (e.g., "Claude Remote" or "Claude Assistant")
5. Optionally add an **App Icon** (recommended: 512x512 PNG)
6. Click **"Create"**

You'll be redirected to your application's dashboard.

---

## Configure Bot Settings

1. In the left sidebar, click **"Bot"**
2. Click **"Add Bot"** (if you haven't already)
3. Confirm by clicking **"Yes, do it!"**
4. **Important Bot Settings:**
   - **Username**: Choose a display name for your bot (e.g., `claude-remote`)
   - **Avatar**: Upload a bot avatar (optional but recommended)
   - **Public Bot**: Keep enabled if you want to share
   - **Requires OAuth2 Code Grant**: Keep disabled unless you're building an integration
5. Under **"Privileged Gateway Intents"**, enable:
   - ✅ **Presence Intent** (optional, if you want to see who's online)
   - ✅ **Server Members Intent** (optional, for user info)
   - ✅ **Message Content Intent** (⚠️ **REQUIRED** - claude-remote needs this to read your messages)
6. You'll see a warning about Message Content Intent — this is expected, click **"Okay"**
7. Click **"Reset Token"** to generate a bot token (or copy if already shown)
   - **⚠️ IMPORTANT**: Copy and save this token immediately! You won't be able to see it again after leaving this page.
   - Store it securely (consider a password manager)

---

## Set Up Bot Permissions

The bot needs specific permissions to function properly. You'll configure these in the next step, but here's what's required:

**Required Permissions:**
- **View Channel** — to see messages
- **Send Messages** — to post Claude's responses
- **Manage Channels** — to create per-session channels and threads
- **Read Message History** — to read previous conversation context
- **Manage Threads** — to organize long conversations
- **Embed Links** — to display rich message embeds (diffs, tool calls, etc.)
- **Attach Files** — to send file attachments (screenshots, edited files)
- **Use External Emojis** (optional) — if you want custom emoji reactions
- **Add Reactions** (optional) — for status indicators

**No permission needed (but recommended):**
- **Send Messages in Threads** — automatically granted with Manage Threads

---

## Invite Bot to Server

1. In the left sidebar, click **"OAuth2"** → **"URL Generator"**
2. Under **"Scopes"**, check:
   - ✅ `bot`
3. Under **"Bot Permissions"**, select:
   - ✅ **View Channel**
   - ✅ **Send Messages**
   - ✅ **Manage Channels**
   - ✅ **Read Message History**
   - ✅ **Manage Threads**
   - ✅ **Embed Links**
   - ✅ **Attach Files**
   - ✅ **Use External Emojis** (optional)
   - ✅ **Add Reactions** (optional)

   *(See "Bot Permissions" section above for why each is needed)*

4. A **Generated URL** will appear at the bottom
5. Copy this URL
6. Open the URL in your browser
7. Select the server you want to add the bot to (you must have **Manage Server** permissions)
8. Click **"Continue"**
9. Review the permissions — they should match what you selected
10. Click **"Authorize"**
11. Complete any CAPTCHA if presented
12. You should see "Authorized" and be redirected

**Verify the bot is online:**
- Go to your server in Discord
- Look for your bot in the member list (usually offline initially)
- The bot will come online when you start `claude-remote`

---

## Configure Channel Structure

### Option A: Use the Default Category (Recommended)

claude-remote can automatically create channels under a category. You have two choices:

1. **Let claude-remote create the category**: During setup, you'll pick an existing category or create a new one
2. **Create the category manually**:
   - In your server, click the **+** next to your channel list
   - Create a **Category** named something like `claude-sessions` or `ai-assistant`
   - Note the category ID (see "Get Required IDs" below)

### Option B: Use an Existing Location

- You can also have Claude create channels directly in the server (no category)
- Or use an existing category you already have

### Category Benefits

Using a dedicated category:
- Keeps Claude channels organized and separate
- Allows you to mute the entire category easily
- Makes it easy to find all Claude-related channels
- You can set category-level permissions if needed

---

## Get Required IDs

During `claude-remote setup`, you'll need:

### 1. Guild (Server) ID

1. In Discord, enable **Developer Mode**:
   - User Settings (gear icon) → **Advanced** → toggle **Developer Mode** on
2. Go to your server
3. Right-click the server icon (top left, next to the server name)
4. Select **"Copy Server ID"**
5. Paste this somewhere safe

### 2. Category ID (if using a category)

1. In Discord, right-click the category you want to use
2. Select **"Copy Category ID"**
3. Paste this somewhere safe

If you want claude-remote to create the category automatically, you don't need the category ID — just the server ID.

---

## Configure claude-remote

Now that Discord is set up, configure claude-remote:

### Option 1: Interactive Setup (Recommended)

```bash
claude-remote setup
```

The setup wizard will guide you through:

1. **Discord Bot Token** — paste the token you copied from the Developer Portal
2. **Discord Server (Guild) ID** — paste the Server ID you copied
3. **Category ID** (optional) — paste the Category ID if you want to use a specific category
   - Press Enter to skip → bot will create channels at server root
4. **Install Claude Code hooks** — recommended: Yes
5. **Install statusline** — recommended: Yes
6. **Set up shell alias** — recommended: Yes (allows `claude` instead of `claude-remote`)
7. **Additional args** — optional extra arguments for Claude
8. **Alias name** — defaults to `claude`, change if you want a different command name

### Option 2: Environment Variables (Non-Interactive)

Create a `.env` file in the config directory (`~/.config/claude-remote/.env`):

```bash
DISCORD_BOT_TOKEN=your_token_here
DISCORD_GUILD_ID=your_guild_id_here
DISCORD_CATEGORY_ID=optional_category_id_here
```

Or set environment variables:

```bash
export DISCORD_BOT_TOKEN="your_token_here"
export DISCORD_GUID_ID="your_guild_id_here"
export DISCORD_CATEGORY_ID="optional_category_id_here"
claude-remote setup
```

---

## Testing Your Setup

1. Start claude-remote:

```bash
claude-remote
# or if you set up the alias:
claude
```

2. You should see in the CLI:
   ```
   Discord sync enabled
   [✓] Connected to Discord
   [✓] Channel created: claude-session-xxxx
   ```

3. In Discord:
   - A new channel should appear (with a name like `claude-session-...`)
   - The bot will be online in your server
   - Messages from Claude will appear as rich embeds
   - **Important:** Read the pinned message in the channel (see below)

4. Try a test prompt:

```bash
claude-remote -p "Hello, can you confirm the Discord connection is working?"
```

5. In Discord:
   - You should see a welcome message
   - Claude's response will appear in the channel
   - Try typing in the channel to interact

### Using the Discord Channel

When you first open the newly created channel, you'll see a **pinned message** with important usage information. Read it carefully — it explains:

- How to interact with Claude (just type messages)
- Available slash commands (`/mode`, `/status`, `/stop`, etc.)
- How to upload images (drag & drop or attachment button)
- How files and diffs are displayed
- Tips for long-running tasks

**About Discord's Slash Autocomplete:**

When you type `/` in Discord, the client will automatically show a dropdown with slash commands. This is Discord's built-in behavior and can't be disabled by the bot. Here's how to work with it:

- **To use a slash command**: Type `/` followed by the command name (e.g., `/mode full`) and press Enter. You can either type quickly before the dropdown appears, or press `Esc` to dismiss it.
- **To send plain text starting with `/`** (like code paths or JSON examples): Escape the slash with a backslash: `\/path/to/file` will display as `/path/to/file` without triggering commands.
- **For code snippets**: Use code blocks (`` `code` `` or ```` ``` ``` ````). Discord won't trigger autocomplete inside code blocks.
- **To disable autocomplete entirely**: Go to User Settings → Text & Images → toggle **"Autocomplete"** off. This disables the popup for all commands.

**Tip:** If you rarely use slash commands, disabling autocomplete provides the smoothest experience. Most interaction can be done by just typing regular messages.

---

## Troubleshooting

### Bot Token Invalid or Expired

**Symptom:** Error about authentication, bot not connecting.

**Fix:**
1. Go to Discord Developer Portal → Bot
2. Click **"Reset Token"** to generate a new one
3. Update your configuration:
   - Run `claude-remote setup` and enter the new token, OR
   - Update `~/.config/claude-remote/.env` with the new token

### Bot Can't Read Messages

**Symptom:** Bot connects but doesn't respond to your Discord messages.

**Fix:**
1. Go to Discord Developer Portal → Bot
2. Ensure **Message Content Intent** is enabled under Privileged Gateway Intents
3. Save changes if you toggled it
4. Restart claude-remote

### Missing Permission Errors

**Symptom:** "Missing Permissions" error in console or Discord.

**Fix:**
1. In Discord server settings, go to **Integrations** → **Bots and Apps**
2. Find your bot and click **"View"**
3. Click **"Edit"** next to permissions
4. Ensure all required permissions are checked (see "Bot Permissions" section)
5. Save and restart claude-remote

If permissions are correct but still failing:
- Check that the bot has access to the channel (not muted or banned)
- Verify the bot's role is above any roles that restrict it

### Channels Appear in Wrong Location

**Symptom:** Session channels appear in a different category or location than expected.

**Fix:**
- If you skipped category during setup, channels will appear at server root
- To change, re-run `claude-remote setup` and provide a category ID
- Or manually create a category and update `~/.config/claude-remote/.env` with `DISCORD_CATEGORY_ID`

### Bot Goes Offline After Starting

**Symptom:** Bot shows as offline in Discord member list.

**Fix:**
- The bot only stays online while `claude-remote` is running
- When you exit Claude, the bot disconnects
- This is expected behavior — the bot is a gateway to your Claude session, not a standalone service
- Start `claude-remote` again to bring the bot online

### Cannot Find Server or Category IDs

**Symptom:** Not sure how to get the IDs.

**Fix:**
1. Enable **Developer Mode**:
   - User Settings → Advanced → Developer Mode → ON
2. Copy IDs by right-clicking:
   - Server: right-click server icon → Copy Server ID
   - Category: right-click category → Copy Category ID
   - Channel: right-click channel → Copy Channel ID

---

## Advanced Configuration

### Multiple Servers

The bot can only be in **one server at a time** for claude-remote. If you want to use it in multiple servers:

1. Invite the bot to only **one** server
2. Use that server as your Claude sync server
3. The bot will create all session channels under that server

The bot can't manage multiple servers because claude-remote maintains a single active connection.

### Custom Channel Prefix

By default, channels are named `claude-session-<random>`. You can customize this by setting:

```bash
# In ~/.config/claude-remote/.env or exported
DISCORD_CHANNEL_PREFIX="ai-session"
```

---

## Security Considerations

- 🛡️ **Never share your bot token** — it's like a password
- 🔒 Keep `~/.config/claude-remote/.env` file permissions restricted:
  ```bash
  chmod 600 ~/.config/claude-remote/.env
  ```
- 🧹 The bot can delete and create channels — only give it to servers you trust
- 👀 Claude's session content will be visible to anyone with access to the Discord channel
- 🔐 If your Discord server has sensitive information, consider:
  - Creating a private server just for Claude
  - Using direct messages with yourself (not currently supported — use a private server)

---

## Summary of Required Discord Settings

| Setting | Value |
|---------|-------|
| **Bot Token** | From Developer Portal → Bot |
| **Guild ID** | Enable Developer Mode → right-click server → Copy Server ID |
| **Category ID** (optional) | Enable Developer Mode → right-click category → Copy Category ID |
| **Message Content Intent** | ✅ Enabled (in Developer Portal) |
| **Bot Permissions** | Send Messages, Manage Channels, Read Message History, Manage Threads, Embed Links, Attach Files |

---

## Next Steps

After completing Discord setup:

1. Test with: `claude-remote -p "Hello, Discord connection test"`
2. Read the main README.md for usage instructions
3. Learn Discord commands: `/status`, `/stop`, `/queue view`, etc.
4. Customize your experience with environment variables

---

**Need Help?**

- Check the main README.md
- Review troubleshooting logs with `DEBUG=claude-remote:* claude-remote`
- Open an issue on GitHub
