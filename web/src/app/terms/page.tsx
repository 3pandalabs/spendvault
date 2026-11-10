import type { Metadata } from "next";
import { A, LegalPage, Mail, Section, UL } from "@/components/legal";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "The terms for using SpendVault, a spending dashboard built from your bank and card statements.",
  alternates: { canonical: "/terms" },
};

const TOC = [
  { id: "service", title: "The service" },
  { id: "advice", title: "Not financial advice" },
  { id: "account", title: "Your account" },
  { id: "content", title: "What you send us" },
  { id: "use", title: "Acceptable use" },
  { id: "accuracy", title: "Accuracy" },
  { id: "price", title: "Price" },
  { id: "liability", title: "Disclaimers and liability" },
  { id: "ending", title: "Ending the service" },
  { id: "law", title: "Governing law" },
  { id: "contact", title: "Contact" },
];

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Use"
      toc={TOC}
      intro={
        <p>
          These terms are an agreement between you and 3PandaLabs LLC, a New Jersey limited liability company (&ldquo;3PandaLabs&rdquo;,
          &ldquo;we&rdquo;), for using SpendVault. By creating an account you agree to them and to our <A href="/privacy">Privacy Policy</A>.
        </p>
      }
    >
      <Section id="service" title="1. The service">
        <p>
          SpendVault reads bank and credit-card statements and transaction alerts that you send it (by email forwarding, upload, your
          phone&apos;s share sheet or WhatsApp), extracts the transactions, and shows you a dashboard, spending alerts and savings suggestions.
          It doesn&apos;t connect to your bank, can&apos;t see your balance in real time and can&apos;t move money.
        </p>
      </Section>

      <Section id="advice" title="2. Not financial advice">
        <p>
          SpendVault gives general information about your own past spending. It is not financial, investment, tax, credit or legal advice, and
          3PandaLabs isn&apos;t a bank, financial adviser or registered investment adviser. Savings estimates are rough estimates. Think about
          your own situation, and talk to a qualified professional before making financial decisions.
        </p>
      </Section>

      <Section id="account" title="3. Your account">
        <UL>
          <li>You must be 18 or older and give accurate account details.</li>
          <li>Keep your password and your private forwarding address secret. Anything sent to that address goes into your account.</li>
          <li>Send only statements for accounts you own or are authorised to use.</li>
        </UL>
      </Section>

      <Section id="content" title="4. What you send us">
        <p>
          You keep ownership of your documents and data. You give us permission to store, process and display them only to provide SpendVault to
          you, including sending them to the processors listed in the Privacy Policy.
        </p>
      </Section>

      <Section id="use" title="5. Acceptable use">
        <UL>
          <li>Don&apos;t send other people&apos;s statements without their permission.</li>
          <li>Don&apos;t upload malware, try to break or overload the service, or reach data that isn&apos;t yours.</li>
          <li>Don&apos;t resell or scrape the service.</li>
        </UL>
      </Section>

      <Section id="accuracy" title="6. Accuracy">
        <p>
          Statements come in many formats, and reading them is automated. Transactions may be missed, misread or put in the wrong category, and
          alerts may be late or missing. Always check your official bank and card statements; they&apos;re the record that counts.
        </p>
      </Section>

      <Section id="price" title="7. Price">
        <p>SpendVault is free while in early access. If we introduce paid plans, we&apos;ll tell you in advance, and you won&apos;t be charged without agreeing.</p>
      </Section>

      <Section id="liability" title="8. Disclaimers and liability">
        <p>
          SpendVault is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, to the fullest extent the law
          allows. To the fullest extent the law allows, 3PandaLabs isn&apos;t liable for indirect, incidental or consequential losses, or for
          decisions you make based on SpendVault, and our total liability for any claim is limited to US$100. Nothing in these terms limits
          liability that can&apos;t be limited by law.
        </p>
      </Section>

      <Section id="ending" title="9. Ending the service">
        <p>
          You can delete your account at any time from Settings. We may suspend or close accounts that break these terms. If we shut
          SpendVault down, we&apos;ll give at least 30 days&apos; notice so you can export your data.
        </p>
      </Section>

      <Section id="law" title="10. Governing law">
        <p>
          These terms are governed by the laws of the State of New Jersey, USA, without regard to conflict-of-law rules. Courts located in New
          Jersey have jurisdiction, except where the law of the country you live in gives you the right to bring a claim locally. We may update
          these terms; if a change matters, we&apos;ll email you first.
        </p>
      </Section>

      <Section id="contact" title="11. Contact">
        <p>
          Questions: <Mail />.
        </p>
      </Section>
    </LegalPage>
  );
}
