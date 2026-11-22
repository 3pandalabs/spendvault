import Link from "next/link";

// Same shape as AdVault's Wordmark.tsx (copied from 3pandalabs/brand's
// attribution/ pattern, copy-not-import): a text wordmark with the "Vault"
// half in the brand amber, and a "| by 3PandaLabs" tag that is a SIBLING of
// the home link, never nested in it (an <a> inside an <a> is invalid).

export function WordmarkName() {
  return (
    <>
      Spend<span className="text-brand">Vault</span>
    </>
  );
}

// The tag is NEVER hidden at any width (3pandalabs/brand brand.md
// consistency rules): where a header is tight it stacks under the name
// instead, and the divider is hidden only while stacked.
const STACK = {
  inline: { box: "", divider: "inline-block" },
  // Stacked below sm (phones), inline from sm up.
  phone: { box: "flex flex-col items-start leading-tight sm:block sm:leading-normal", divider: "hidden sm:inline-block" },
  // Also stacked lg..xl, where the desktop nav takes the room.
  "phone-lg": {
    box: "flex flex-col items-start leading-tight sm:block sm:leading-normal lg:flex lg:leading-tight xl:block xl:leading-normal",
    divider: "hidden sm:inline-block lg:hidden xl:inline-block",
  },
} as const;
type Stack = keyof typeof STACK;

export function WordmarkTag({ stack = "inline" }: { stack?: Stack }) {
  return (
    <span>
      <span
        aria-hidden
        className={`mx-2 ${STACK[stack].divider} h-3.5 w-px translate-y-[1px] bg-current align-middle opacity-20`}
      />
      <a
        href="https://3pandalabs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="align-middle font-mono text-[10px] font-normal uppercase tracking-widest text-zinc-500 hover:text-zinc-300 hover:underline"
      >
        by 3PandaLabs
      </a>
    </span>
  );
}

/** Full wordmark (name + tag) for places where it is not wrapped in a link. */
export function Wordmark() {
  return (
    <>
      <WordmarkName />
      <WordmarkTag />
    </>
  );
}

/** Header logo: home link + attribution tag as siblings. */
export function Logo({ href = "/", tag = true, stack = "inline" }: { href?: string; tag?: boolean; stack?: Stack }) {
  return (
    <div className={`text-lg font-semibold tracking-tight whitespace-nowrap text-fg ${tag ? STACK[stack].box : ""}`}>
      <Link href={href}>
        <WordmarkName />
      </Link>
      {tag ? <WordmarkTag stack={stack} /> : null}
    </div>
  );
}
