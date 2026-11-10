import type { Metadata } from "next";
import { A, H3, LegalPage, Mail, Section, UL } from "@/components/legal";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "What SpendVault collects from your bank and card statements, how it's protected, who processes it, and how to export or delete it.",
  alternates: { canonical: "/privacy" },
};

const TOC = [
  { id: "summary", title: "The short version" },
  { id: "collect", title: "What we collect" },
  { id: "not-collect", title: "What we never collect" },
  { id: "use", title: "How we use it" },
  { id: "processors", title: "Who processes it for us" },
  { id: "security", title: "How it's protected" },
  { id: "retention", title: "How long we keep it" },
  { id: "rights", title: "Your rights, including under India's DPDP Act" },
  { id: "children", title: "Children" },
  { id: "changes", title: "Changes" },
  { id: "contact", title: "Contact and grievances" },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      toc={TOC}
      intro={
        <>
          <p>
            SpendVault is a service of 3PandaLabs LLC, a New Jersey limited liability company (&ldquo;3PandaLabs&rdquo;, &ldquo;we&rdquo;,
            &ldquo;us&rdquo;). It reads the bank and credit-card statements you choose to send it and turns them into a spending dashboard.
            Because that is financial data, this policy is specific about exactly what we touch.
          </p>
        </>
      }
    >
      <Section id="summary" title="1. The short version">
        <UL>
          <li>We only see what you send us: emails your Gmail filter forwards, files you upload or share, and files you send on WhatsApp.</li>
          <li>We never ask for, and never have, your bank or card login. We can&apos;t move money.</li>
          <li>Original statement files are deleted after we read them, unless you turn that off in Settings.</li>
          <li>PDF passwords are encrypted and never shown back to anyone, including you.</li>
          <li>We don&apos;t sell your data or use it for advertising. You can export or delete everything at any time.</li>
        </UL>
      </Section>

      <Section id="collect" title="2. What we collect">
        <H3>Account details</H3>
        <p>Your name, email address and a hashed password (we can&apos;t read it). Your settings, such as alert emails and base currency.</p>
        <H3>Forwarded statement emails</H3>
        <p>
          Each account gets a private forwarding address. When an email arrives there, we store its sender, subject, date and attachments
          (statement PDFs, CSV or Excel files, or the body of a transaction alert) long enough to read them. We also capture Gmail&apos;s
          forwarding confirmation code so we can show it to you during setup.
        </p>
        <H3>Uploaded and shared files</H3>
        <p>Statement files you upload in the web app, share from your phone&apos;s share sheet, or send to our WhatsApp number.</p>
        <H3>Extracted transactions</H3>
        <p>
          From those documents we extract transaction date, description, merchant, amount, debit or credit, the card or account it belongs to
          (bank name and last 4 digits only), and statement totals. We assign each transaction a category, which you can change.
        </p>
        <H3>PDF passwords</H3>
        <p>Passwords you save so we can open locked statement PDFs, stored encrypted, as described in section 6.</p>
        <H3>WhatsApp number (only if you link it)</H3>
        <p>
          If you link WhatsApp, we store your phone number so we can match files you send to your account, plus the messages and files you
          send to our number.
        </p>
        <H3>Technical data</H3>
        <p>
          Standard server logs (IP address, browser type, timestamps, request paths) used for security and debugging. Our logs record ids and
          counts only: never amounts, merchants, statement text or passwords.
        </p>
      </Section>

      <Section id="not-collect" title="3. What we never collect">
        <UL>
          <li>Net banking, card or UPI login credentials, OTPs or PINs.</li>
          <li>Full card numbers (we keep only the last 4 digits printed on the statement).</li>
          <li>The rest of your inbox. Gmail forwards only emails that match the filter you create, and you can delete the filter at any time.</li>
          <li>Contacts, location or device data from your phone.</li>
        </UL>
      </Section>

      <Section id="use" title="4. How we use it">
        <UL>
          <li>To read your statements and show your dashboard, transactions, alerts and savings suggestions.</li>
          <li>To send you emails you&apos;ve asked for: spending alerts (you can turn these off), password resets and service notices.</li>
          <li>To keep the service secure, prevent abuse and fix problems.</li>
          <li>Your category corrections teach the app how to categorise your own future transactions. They aren&apos;t shared with other users.</li>
        </UL>
        <p>We don&apos;t sell or rent your data, and we don&apos;t use it for advertising or to build profiles for anyone else.</p>
      </Section>

      <Section id="processors" title="5. Who processes it for us">
        <p>We use a small number of service providers, each only for the job listed:</p>
        <UL>
          <li>
            <strong>Hetzner Online GmbH</strong> (Germany): hosts our servers and database, where your account, transactions and encrypted
            documents are stored.
          </li>
          <li>
            <strong>Cloudflare, Inc.</strong> (USA): serves the website, receives forwarded emails for your SpendVault address, and stores
            encrypted backups.
          </li>
          <li>
            <strong>Anthropic, PBC</strong> (USA): when AI extraction is enabled, statement pages that our built-in parsers can&apos;t read,
            and descriptions we can&apos;t categorise, are sent to Anthropic&apos;s API to extract transactions. Anthropic processes this
            data under commercial terms that don&apos;t allow it to train models on our API data.
          </li>
          <li>
            <strong>Meta Platforms, Inc.</strong> (WhatsApp Business Platform): only if you link WhatsApp. Messages and files you send to our
            WhatsApp number pass through Meta.
          </li>
          <li>
            <strong>Resend, Inc.</strong> (USA): delivers our emails (alerts and password resets).
          </li>
        </UL>
        <p>
          Some of these providers process data outside India. We transfer data only to countries not restricted by the Government of India
          under the DPDP Act, and we require providers to protect it.
        </p>
        <p>We may also disclose data if the law requires it, or to protect the rights and safety of our users or of 3PandaLabs.</p>
      </Section>

      <Section id="security" title="6. How it's protected">
        <UL>
          <li>All traffic uses HTTPS.</li>
          <li>PDF passwords and stored original documents are encrypted with AES-256-GCM before they&apos;re written to disk.</li>
          <li>Every request is checked against your account. Nobody else&apos;s account can reach your data.</li>
          <li>Access to production systems is limited to the 3PandaLabs team and protected by multi-factor access controls.</li>
        </UL>
        <p>No system is perfectly secure. If a breach affects your data, we&apos;ll notify you and the authorities as the law requires.</p>
      </Section>

      <Section id="retention" title="7. How long we keep it">
        <UL>
          <li>
            <strong>Original files and emails:</strong> deleted once they&apos;ve been read successfully, unless you turn off &ldquo;Delete
            original files after reading&rdquo;. Files we can&apos;t read yet (for example, waiting for a password) are kept until you retry or
            delete them.
          </li>
          <li>
            <strong>Transactions, accounts and alerts:</strong> kept while your account is open, so you can see trends over time.
          </li>
          <li>
            <strong>Everything:</strong> deleted within 30 days of you deleting your account, except encrypted backups, which roll off within
            a further 30 days.
          </li>
          <li>Server logs are kept for up to 30 days.</li>
        </UL>
      </Section>

      <Section id="rights" title="8. Your rights, including under India's DPDP Act">
        <p>
          If you are in India, the Digital Personal Data Protection Act, 2023 gives you the right to access a summary of your personal data,
          to correct and complete it, to have it erased, to nominate someone to exercise your rights if you die or become incapacitated, and to
          grievance redressal. You can withdraw consent at any time by deleting your account; this doesn&apos;t affect processing that
          happened before.
        </p>
        <p>Wherever you live, you can:</p>
        <UL>
          <li>
            <strong>Export</strong> every transaction, account and alert from <A href="/settings">Settings</A> as a JSON file.
          </li>
          <li>
            <strong>Correct</strong> any transaction&apos;s category, and delete any document along with its transactions.
          </li>
          <li>
            <strong>Delete</strong> your account and all its data from <A href="/settings">Settings</A>, or see{" "}
            <A href="/delete-account">how to delete your account</A>.
          </li>
          <li>
            <strong>Stop</strong> new data at any time by removing your Gmail filter or unlinking WhatsApp.
          </li>
        </UL>
        <p>
          For anything else, email <Mail />. We answer within 30 days. If you&apos;re not satisfied, you can complain to the Data Protection
          Board of India or your local data protection authority.
        </p>
      </Section>

      <Section id="children" title="9. Children">
        <p>SpendVault is for people 18 and older. We don&apos;t knowingly collect data from children; if you believe a child has signed up, email us and we&apos;ll delete the account.</p>
      </Section>

      <Section id="changes" title="10. Changes">
        <p>
          If we change this policy in a way that matters, we&apos;ll email you before it takes effect. The date at the top shows the latest
          version.
        </p>
      </Section>

      <Section id="contact" title="11. Contact and grievances">
        <p>
          3PandaLabs LLC, New Jersey, USA. Email <Mail /> for privacy questions, data requests and grievances (our Grievance Officer reads this
          mailbox). This policy is governed by the laws of the State of New Jersey, USA, without affecting any rights you have under the laws of
          the country where you live.
        </p>
      </Section>
    </LegalPage>
  );
}
