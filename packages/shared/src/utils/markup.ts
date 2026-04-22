export function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export function stripMarkupToText(value: string): string {
  return decodeHtmlEntities(
    value
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

export function pickFirstTagText(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  if (!match) return null;
  const raw = match[1]!;
  const cdata = raw.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return stripMarkupToText(cdata ? cdata[1]! : raw);
}

export function pickAllTagText(block: string, tag: string): string[] {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(block)) !== null) {
    const value = stripMarkupToText(match[1]!);
    if (value) out.push(value);
  }
  return out;
}

export function pickTagAttr(
  block: string,
  tag: string,
  attr: string,
): string | null {
  const re = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]+)"[^>]*\\/?>`, "i");
  const match = block.match(re);
  return match ? match[1]! : null;
}
