import type { Metadata } from "next";
import { A, LegalPage, Mail, Section, UL } from "@/components/legal";

export const metadata: Metadata = {
  title: "Delete your account",
  description: "How to delete your SpendVault account and all of its data.",
  alternates: { canonical: "/delete-account" },
};

export default function DeleteAccountPage() {
  return (
    <LegalPage
      title="Delete your SpendVault account"
      toc={[]}
      intro={<p>You can delete your account and everything in it yourself, at any time. It takes under a minute.</p>}
    >
      <Section id="how" title="How to delete">
        <ol className="list-decimal space-y-2 pl-5">
          <li>
            <A href="/login?next=/settings">Sign in</A> and open <strong>Settings</strong>.
          </li>
          <li>Optional: tap <strong>Download export</strong> to keep a copy of your transactions.</li>
          <li>
            Tap <strong>Delete my account</strong>, enter your password, and confirm.
          </li>
          <li>Remove the Gmail filter that forwards to your SpendVault address, so Gmail stops sending mail there.</li>
        </ol>
        <p>
          Can&apos;t sign in? Email <Mail /> from the address on your account and we&apos;ll delete it for you.
        </p>
      </Section>
      <Section id="what" title="What gets deleted">
        <UL>
          <li>Your account, settings and forwarding address.</li>
          <li>All documents and emails you sent us, and every transaction, account and alert extracted from them.</li>
          <li>Saved PDF passwords and your WhatsApp link.</li>
        </UL>
        <p>Deletion is immediate in the app. Encrypted backups roll off within 30 days. See the <A href="/privacy">Privacy Policy</A>.</p>
      </Section>
    </LegalPage>
  );
}
