import Link from "next/link";

/** App icon (same artwork as the favicon, src/app/icon.svg). Decorative: the name beside it carries meaning. */
export function BrandMark({ className = "size-7" }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG, no optimisation needed
    <img src="/icon.svg" alt="" aria-hidden="true" width={28} height={28} className={`${className} shrink-0 rounded-md`} />
  );
}

/** "| by 3PandaLabs" attribution, a sibling of the home link, never nested in it. */
export function WordmarkTag({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center ${className}`}>
      <span aria-hidden className="mx-2 inline-block h-3.5 w-px bg-current opacity-20" />
      <a
        href="https://3pandalabs.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-[10px] font-normal uppercase tracking-widest text-fg-muted hover:text-fg hover:underline"
      >
        by 3PandaLabs
      </a>
    </span>
  );
}

export function Logo({ href = "/", tag = true }: { href?: string; tag?: boolean }) {
  return (
    <span className="inline-flex items-center">
      <Link href={href} className="inline-flex items-center gap-2 text-lg font-semibold tracking-tight text-fg">
        <BrandMark />
        SpendVault
      </Link>
      {tag ? <WordmarkTag className="hidden sm:inline-flex" /> : null}
    </span>
  );
}
