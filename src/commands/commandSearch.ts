export interface Command {
  id: string;
  title: string;
  /** Heading the command is listed under when the palette shows everything. */
  section: string;
  /** Extra words that should find this command, e.g. "night" for the dark theme. */
  keywords?: string;
  /** Display only, e.g. "⌘↵". The binding itself is registered elsewhere. */
  shortcut?: string;
  run(): void;
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function initials(title: string): string {
  return title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("");
}

/** Lower is better; null means no match. */
function rank(command: Command, query: string): number | null {
  const title = command.title.toLowerCase();
  const tokens = query.split(/\s+/).filter(Boolean);
  const everything = `${title} ${command.section} ${command.keywords ?? ""}`.toLowerCase();

  if (!tokens.every((token) => everything.includes(token))) {
    // "np" finds "New pad".
    return initials(command.title).startsWith(query.replace(/\s+/g, "")) ? 3 : null;
  }
  if (title.startsWith(query)) return 0;
  if (tokens.every((token) => new RegExp(`(^|[^a-z0-9])${escapeRegExp(token)}`).test(title))) return 1;
  if (tokens.every((token) => title.includes(token))) return 2;
  return 4;
}

/** Filters and ranks commands for the palette. An empty query returns them all, in order. */
export function searchCommands<T extends Command>(commands: T[], rawQuery: string): T[] {
  const query = rawQuery.trim().toLowerCase();
  if (query === "") return commands;
  return commands
    .map((command, index) => ({ command, index, rank: rank(command, query) }))
    .filter((entry): entry is { command: T; index: number; rank: number } => entry.rank !== null)
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.command);
}
