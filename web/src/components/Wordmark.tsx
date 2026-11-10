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

export function WordmarkTag({ className = "" }: { className?: string }) {
  return (
    <span className={className}>
      <span
        aria-hidden
        className="mx-2 inline-block h-3.5 w-px translate-y-[1px] bg-current align-middle opacity-20"
      />
      <a
        href="https://3pandalabs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="align-middle font-mono text-[10px] font-normal tracking-widest text-zinc-500 hover:text-zinc-300 hover:underline"
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
export function Logo({ href = "/", tag = true, tagClassName = "" }: { href?: string; tag?: boolean; tagClassName?: string }) {
  return (
    <div className="text-lg font-semibold tracking-tight whitespace-nowrap text-fg">
      <Link href={href}>
        <WordmarkName />
      </Link>
      {tag ? <WordmarkTag className={tagClassName} /> : null}
    </div>
  );
}
