/**
 * Minecraft text formatting (LuckPerms prefixes, group display names) parsed
 * into a safe, structured form. The result is plain data – text plus validated
 * hex colours and style flags – so it can be rendered as React text nodes and
 * never as HTML.
 *
 * Supported: legacy codes with `&` or `§` (colours 0-9a-f, k-o styles, r reset),
 * hex colours `&#RRGGBB`, `§x§R§R§G§G§B§B` (and the `&x` form), `{#RRGGBB}`,
 * and the common MiniMessage tags (`<red>`, `<color:#hex>`, `<#hex>`, `<bold>`,
 * `<b>`, `<italic>`, `<i>`, `<em>`, `<underlined>`, `<u>`, `<strikethrough>`,
 * `<st>`, `<obfuscated>`, `<obf>`, `<reset>`, `<gradient:…>` / `<rainbow>` as
 * their first colour, closing tags). Anything else is kept or dropped as
 * readable text – unknown tags are removed, never interpreted.
 */

export interface TextStyle {
  /** #RRGGBB (uppercase) or null for the default colour. */
  color: string | null;
  bold: boolean;
  italic: boolean;
  underlined: boolean;
  strikethrough: boolean;
  obfuscated: boolean;
}

export interface TextSegment extends TextStyle {
  text: string;
}

export const LEGACY_COLORS: Readonly<Record<string, string>> = {
  '0': '#000000', '1': '#0000AA', '2': '#00AA00', '3': '#00AAAA', '4': '#AA0000', '5': '#AA00AA', '6': '#FFAA00', '7': '#AAAAAA',
  '8': '#555555', '9': '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF',
};

export const NAMED_COLORS: Readonly<Record<string, string>> = {
  black: '#000000', dark_blue: '#0000AA', dark_green: '#00AA00', dark_aqua: '#00AAAA', dark_red: '#AA0000', dark_purple: '#AA00AA',
  gold: '#FFAA00', gray: '#AAAAAA', grey: '#AAAAAA', dark_gray: '#555555', dark_grey: '#555555', blue: '#5555FF', green: '#55FF55',
  aqua: '#55FFFF', red: '#FF5555', light_purple: '#FF55FF', yellow: '#FFFF55', white: '#FFFFFF',
};

const STYLE_TAGS: Record<string, keyof Omit<TextStyle, 'color'>> = {
  bold: 'bold', b: 'bold',
  italic: 'italic', i: 'italic', em: 'italic',
  underlined: 'underlined', u: 'underlined',
  strikethrough: 'strikethrough', st: 'strikethrough',
  obfuscated: 'obfuscated', obf: 'obfuscated',
};

const KNOWN_TAGS = new Set([...Object.keys(STYLE_TAGS), 'color', 'colour', 'c', 'reset', 'r', 'gradient', 'transition', 'rainbow', 'hover', 'click', 'font', 'insert', 'insertion', 'shadow', 'pride']);

const LEGACY_STYLES: Record<string, keyof Omit<TextStyle, 'color'>> = { k: 'obfuscated', l: 'bold', m: 'strikethrough', n: 'underlined', o: 'italic' };

/** Maximum input length handled (LuckPerms prefixes are at most 255 characters here). */
export const MAX_FORMATTED_LENGTH = 512;

const HEX6 = /^[0-9a-fA-F]{6}$/;
export const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

function plainStyle(): TextStyle {
  return { color: null, bold: false, italic: false, underlined: false, strikethrough: false, obfuscated: false };
}

/** Colour of a MiniMessage colour argument (`red`, `#ff0000`), or null. */
function colorArg(value: string): string | null {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#') && HEX6.test(v.slice(1))) return v.toUpperCase();
  return NAMED_COLORS[v] ?? null;
}

/** Parses Minecraft-formatted text into styled segments (whitespace-trimmed, empty segments removed). */
export function parseMinecraftText(input: string | null | undefined): TextSegment[] {
  if (!input) return [];
  const raw = input.slice(0, MAX_FORMATTED_LENGTH);
  const segments: TextSegment[] = [];
  let style = plainStyle();
  /** MiniMessage tag stack: each open tag restores the previous style when closed. */
  const stack: { name: string; previous: TextStyle }[] = [];
  let buffer = '';

  const flush = () => {
    if (!buffer) return;
    const last = segments[segments.length - 1];
    if (last && sameStyle(last, style)) last.text += buffer;
    else segments.push({ ...style, text: buffer });
    buffer = '';
  };
  const change = (next: TextStyle) => {
    flush();
    style = next;
  };

  let i = 0;
  while (i < raw.length) {
    const c = raw[i];

    // Legacy codes: & or § followed by a code character.
    if ((c === '&' || c === '§') && i + 1 < raw.length) {
      const code = raw[i + 1].toLowerCase();
      // &#RRGGBB
      if (code === '#' && HEX6.test(raw.slice(i + 2, i + 8))) {
        change({ ...plainStyle(), color: `#${raw.slice(i + 2, i + 8).toUpperCase()}` });
        i += 8;
        continue;
      }
      // §x§R§R§G§G§B§B (Bukkit/BungeeCord hex)
      if (code === 'x') {
        const digits: string[] = [];
        let j = i + 2;
        while (digits.length < 6 && j + 1 < raw.length && (raw[j] === '&' || raw[j] === '§') && /[0-9a-fA-F]/.test(raw[j + 1])) {
          digits.push(raw[j + 1]);
          j += 2;
        }
        if (digits.length === 6) {
          change({ ...plainStyle(), color: `#${digits.join('').toUpperCase()}` });
          i = j;
          continue;
        }
      }
      if (LEGACY_COLORS[code]) {
        // A legacy colour resets the styles, like in Minecraft.
        change({ ...plainStyle(), color: LEGACY_COLORS[code] });
        i += 2;
        continue;
      }
      if (LEGACY_STYLES[code]) {
        change({ ...style, [LEGACY_STYLES[code]]: true });
        i += 2;
        continue;
      }
      if (code === 'r') {
        change(plainStyle());
        i += 2;
        continue;
      }
    }

    // {#RRGGBB} (used by some chat plugins)
    if (c === '{' && raw[i + 1] === '#' && raw[i + 8] === '}' && HEX6.test(raw.slice(i + 2, i + 8))) {
      change({ ...style, color: `#${raw.slice(i + 2, i + 8).toUpperCase()}` });
      i += 9;
      continue;
    }

    // MiniMessage tags.
    if (c === '<') {
      const end = raw.indexOf('>', i + 1);
      const body = end > i ? raw.slice(i + 1, end) : '';
      if (end > i && body.length > 0 && body.length <= 128 && !body.includes('<')) {
        const handled = applyTag(body);
        if (handled) {
          i = end + 1;
          continue;
        }
      }
    }

    buffer += c;
    i++;
  }
  flush();
  return tidy(segments);

  /** Applies a MiniMessage tag; returns false when it is not a tag (kept as text). */
  function applyTag(body: string): boolean {
    const closing = body.startsWith('/');
    const content = closing ? body.slice(1) : body;
    const [nameRaw, ...args] = content.split(':');
    const name = nameRaw.trim().toLowerCase();
    if (!/^[#a-z_][a-z0-9_#!?-]*$/.test(name)) return false;

    if (closing) {
      // Close the most recent matching tag (and everything opened after it).
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].name === name || (name.startsWith('#') && stack[k].name === 'color')) {
          change(stack[k].previous);
          stack.length = k;
          return true;
        }
      }
      // Unmatched closing tag: known tags are dropped, anything else stays readable text.
      return KNOWN_TAGS.has(name) || !!NAMED_COLORS[name] || name.startsWith('#');
    }
    if (name === 'reset' || name === 'r') {
      stack.length = 0;
      change(plainStyle());
      return true;
    }
    const push = (next: TextStyle, tagName = name) => {
      stack.push({ name: tagName, previous: style });
      change(next);
    };
    if (name.startsWith('#') && HEX6.test(name.slice(1))) {
      push({ ...style, color: name.toUpperCase() }, 'color');
      return true;
    }
    if (NAMED_COLORS[name]) {
      push({ ...style, color: NAMED_COLORS[name] });
      return true;
    }
    if (name === 'color' || name === 'colour' || name === 'c') {
      const color = args.length ? colorArg(args[0]) : null;
      push({ ...style, color: color ?? style.color }, 'color');
      return true;
    }
    if (STYLE_TAGS[name]) {
      // <bold:false> turns a style off.
      push({ ...style, [STYLE_TAGS[name]]: args[0]?.trim().toLowerCase() !== 'false' });
      return true;
    }
    if (name === 'gradient' || name === 'transition') {
      // Approximated by the first colour (a per-character gradient is not needed for a badge).
      const first = args.map(colorArg).find((col): col is string => !!col);
      push({ ...style, color: first ?? style.color });
      return true;
    }
    if (name === 'rainbow') {
      push({ ...style, color: '#FF5555' });
      return true;
    }
    // Interactive or unsupported tags (hover, click, font, lang, key, insertion, …): removed, text kept.
    if (['hover', 'click', 'font', 'insert', 'insertion', 'shadow', 'pride', 'newline', 'br', 'sprite', 'head'].includes(name)) {
      push(style);
      return true;
    }
    return false;
  }
}

function sameStyle(a: TextStyle, b: TextStyle): boolean {
  return a.color === b.color && a.bold === b.bold && a.italic === b.italic && a.underlined === b.underlined && a.strikethrough === b.strikethrough && a.obfuscated === b.obfuscated;
}

/** Collapses whitespace runs, trims the outer whitespace and drops empty segments. */
function tidy(segments: TextSegment[]): TextSegment[] {
  const out: TextSegment[] = [];
  for (const s of segments) {
    // Control characters (including stray § without a code) are never displayed.
    // eslint-disable-next-line no-control-regex
    const text = s.text.replace(/[\u0000-\u001f\u007f]/g, '').replace(/§/g, '').replace(/\s+/g, ' ');
    if (text) out.push({ ...s, text });
  }
  while (out.length && !out[0].text.trimStart()) out.shift();
  while (out.length && !out[out.length - 1].text.trimEnd()) out.pop();
  if (out.length) {
    out[0] = { ...out[0], text: out[0].text.trimStart() };
    const last = out.length - 1;
    out[last] = { ...out[last], text: out[last].text.trimEnd() };
  }
  return out.filter((s) => s.text);
}

/** Plain text of formatted Minecraft text. */
export function minecraftPlainText(input: string | null | undefined): string {
  return parseMinecraftText(input)
    .map((s) => s.text)
    .join('');
}

/** "server_admin" → "Server Admin" (LuckPerms group identifiers are lowercase). */
export function humanizeGroupName(group: string): string {
  return group
    .split(/[_\-.\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
