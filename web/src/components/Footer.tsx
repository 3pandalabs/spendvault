import Link from "next/link";

export function Footer() {
  return (
    <footer className="border-t border-line px-4 py-8">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 text-sm text-fg-muted">
        <span>&copy; 3PandaLabs LLC. SpendVault is not financial advice.</span>
        <nav aria-label="Legal" className="flex flex-wrap gap-4">
          <Link href="/privacy" className="hover:text-fg hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-fg hover:underline">
            Terms
          </Link>
          <Link href="/delete-account" className="hover:text-fg hover:underline">
            Delete account
          </Link>
          <a href="mailto:hello@3pandalabs.com" className="hover:text-fg hover:underline">
            Contact
          </a>
        </nav>
      </div>
    </footer>
  );
}
