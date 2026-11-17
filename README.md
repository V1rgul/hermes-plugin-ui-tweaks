# Hermes UI Tweaks

A small plugin for Hermes Desktop presentation preferences.

## Settings

Open **Settings → Plugins → Hermes UI Tweaks**. All switches are enabled by default.

### Tool calls

- **Lists: expand by default** — Show the list of calls without opening every call’s input/output details.
- **Lists: tree toggle instead of summary line** — Open lists drop their summary line; a minus box at the top of the tree folds them. Folded lists keep their summary, with a plus box.
- **File edits: fold diffs by default** — Keep patches and file-edit diffs closed until you open them. Leave Hermes “Hide code diffs” off to keep them reopenable.
- **Output and diffs: taller boxes** — Opened calls and file-edit diffs show up to three times more lines before scrolling, within the window height. Short results keep their size.
- **Rows: compact** — Tool calls run one text size smaller, without gaps between them. Opened results keep their size. **Always on.**

### Composer

- **Status stack: fold by default** — Start the branch and activity drawer folded when the queue is empty. Queue expansion is controlled separately below.
- **Queued prompts: expand list by default** — Open the queue list when prompts are added or updated, revealing its drawer if necessary. Works independently of status-stack folding.
- **Queued prompts: expand long text by default** — Use each queued prompt’s native expanded text view, without opening a closed queue list.

### Conversation

- **Long messages: taller edit box** — Sent prompts stay folded. Clicking one opens an edit box that shows up to three times more lines before scrolling, within the window height.
- **Duplicated messages: resync automatically** — When a finished turn shows repeated blocks, rebuild the chat from the server. The broom next to the model picker does the same on demand and turns orange on duplicates.
- **Timestamps: share existing lines** — With Hermes timestamps on, a text block’s time sits at the end of its first line and the message’s time in its action row, instead of each taking a line. **Always on.**
- **HTML previews: full width** — Use the full available message width without changing preview content or state. **Always on.**

## Installation or update

1. In Hermes Desktop, open **Capabilities → Plugins → Install from Git**.
2. Enter `https://github.com/V1rgul/hermes-plugin-ui-tweaks` and select **Desktop UI** only.
3. Enable **Advanced → Force reinstall**, click **Install**, and enable **Hermes UI Tweaks**.

Technical details and tests: [Development](docs/development.md).
